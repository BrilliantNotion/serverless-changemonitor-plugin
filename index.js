'use strict';

/**
 * Serverless AutoDeploy Plugin
 */

module.exports = function(S)
{
	const SCli = require(S.getServerlessPath('utils/cli'));
	const SError = require(S.getServerlessPath('Error'));
	const path = require('path');
	const fs = require('fs');
	const BbPromise = require('bluebird');
	const process = require("process");
	const spawn = require("child_process").spawn;
	const keypress = require('keypress');
	const glob = require("glob");
	const _ = require("lodash");
	const chalk = require("chalk");
	const semver = require("semver");

	/**
	 * ServerlessChangeMonitorPlugin
	 */

	class ServerlessChangeMonitorPlugin extends S.classes.Plugin
	{
		constructor()
		{
			super();

			this._serverlessVersionMinimum = "0.5.0";
			this._deployTriggerDelay = 500;

			this._fsWatcherOptions =
			{
				"persistent": true,
				"recursive": false
			};

			this._directoriesIgnore =
			[
				".git",
				"_meta",
				"node_modules",
				"plugins"
			];

			this._filesIgnore =
			[
				"s-function.js",
				"s-project.js",
				"s-resources-cf.js",
				"s-templates.js",
				"package.json",
				"event.json"
			];

			this._fileExtensions =
			[
				// ".py",
				".json",
				".js"
			];

			this._libDirectories = [];
			this._fsWatchers = {};
			this._currentlyDeploying = [];
			this._jobQueue = [];
			this._jobQueueRunning = false;
		}

		/**
		 * Plugin Name
		 */

		static getName()
		{
			return 'com.brilliantnotion.' + ServerlessChangeMonitorPlugin.name;
		}

		/**
		 * Register Actions
		 */

		registerActions()
		{
			S.addAction(this.changeMonitorDeploy.bind(this),
			{
				"handler": "changeMonitorDeploy",
				"description": "Monitor the file system for changes and deploy when a change is detected that affects a function.",
				"context": "changemonitor",
				"contextAction": "deploy",
				"options":
				[
					{
						"option": "beep",
						"shortcut": "b",
						"description": "Emit a beep on a successful deploy."
					},
					// {
					// 	"option": "excludedirectory",
					// 	"shortcut": "ed",
					// 	"description": "Exclude a directory from monitoring."
					// },
					// {
					// 	"option": "excludefile",
					// 	"shortcut": "ef",
					// 	"description": "Exclude a file from monitoring."
					// },
					// {
					// 	"option": "deployfunctions",
					// 	"shortcut": "df",
					// 	"description": "Deploy functions only. (Default action.)"
					// },
					// {
					// 	"option": "deployendpoints",
					// 	"shortcut": "de",
					// 	"description": "Deploy endpoints only."
					// },
					// {
					// 	"option": "deployall",
					// 	"shortcut": "da",
					// 	"description": "Deploy both functions and endpoints."
					// },
					// {
					// 	"option": "lib",
					// 	"shortcut": "l",
					// 	"description": "Specify a libary folder to monitor."
					// },
					{
						"option": "region",
						"shortcut": "r",
						"description": "The region to deploy to. (Required if more than one region exists.)"
					},
					{
						"option": "stage",
						"shortcut": "s",
						"description": "The stage to deploy to. (Required if more than one stage exists.)"
					}
				],
				parameters:
				[
					// Use paths when you multiple values need to be input (like an array).  Input looks like this: "serverless custom run module1/function1 module1/function2 module1/function3.  Serverless will automatically turn this into an array and attach it to evt.options within your plugin
					{
						"parameter": "paths",
						"description": "One or multiple paths to your function",
						"position": "0->" // Can be: 0, 0-2, 0->  This tells Serverless which params are which.  3-> Means that number and infinite values after it.
					}
				]
			});

			return BbPromise.resolve();
		}

		/**
		 * Register Hooks
		 */

		registerHooks()
		{
			// Add function deploy post hook.
			S.addHook(this._hookPost.bind(this),
			{
				action: 'functionDeploy',
				event:  'post'
			});

			return BbPromise.resolve();
		}

		/**
		 * Change Monitor Deploy
		 */

		changeMonitorDeploy(evt)
		{
			let _this = this;
			_this.evt = evt;

			return new BbPromise.bind(_this)
			.then(_this._checkServerlessVersion)
			.then(_this._validateAndPrepare)
			.then(_this._watchersStart);
		}

		_checkServerlessVersion()
		{
			if(!semver.satisfies(S._version, ">=" + this._serverlessVersionMinimum))
				SCli.log(chalk.red.bold("WARNING: This version of the Serverless Optimizer Plugin will not work with a version of Serverless that is less than v0.2."));
		}

		_validateAndPrepare()
		{
			let _this = this;

			return new BbPromise(function(resolve, reject)
			{
				let stageNames = _.keys(S._project.stages);
				let regionNames = [];
				let stageCount = _.size(stageNames);
				let regionCount = 0;

				// Populate region arrays.
				_.forEach(S._project.stages, function(value, key)
				{
					regionNames = _.concat(regionNames, _.keys(value.regions));
				});
				regionNames = _.uniq(regionNames);

				// Count regions.
				regionCount += _.size(regionNames);

				// Check if stage is required and was specified.
				if(!_this.evt.options.stage && stageCount > 1)
					return reject(new SError("A stage must be specified if there is more than one stage or region in your project."));

				// Check if region is required and was specified.
				if(!_this.evt.options.region && regionCount > 1)
					return reject(new SError("A region must be specified if there is more than one stage or region in your project."));

				// Check if the specified stage is valid.
				if(_this.evt.options.stage && !_.includes(stageNames, _this.evt.options.stage))
					return reject(new SError("The stage specified does not exist in your project."));

				// Check if the specified region is valid.
				if(_this.evt.options.region && !_.includes(regionNames, _this.evt.options.region))
					return reject(new SError("The region specified does not exist in your project."));

				return resolve();
			});
		}

		_watchersStart()
		{
			let _this = this;
			return new BbPromise(function(resolve, reject)
			{
				_this._cliHandlerStart();
				_this._watchStart("./");

				// The change monitor will never resolve.
				// return resolve(evt);
			});
		}

		_bell()
		{
			SCli.log('\x07');
		}

		_isInteractive()
		{
			return process.stdout.isTTY && !process.env.CI;
		}

		_fileExists(filePath)
		{
			try
			{
				return fs.statSync(filePath).isFile();
			}
			catch(error)
			{
				return false;
			}
		}

		_getDirectories(directory)
		{
			return fs.readdirSync(directory).filter(function(file)
			{
				return fs.statSync(path.join(directory, file)).isDirectory();
			});
		}

		_keypressHandler(chunk, key)
		{
			if(key)
			{
				if(key.name == "return")
				{
					SCli.log("");
					return;
				}

				if((key.ctrl && key.name == "c") || (key.name == "escape"))
				{
					SCli.log("Monitoring stopped.");
					process.exit();
				}
			}
		}

		_cliHandlerStart()
		{
			if(process.stdout.isTTY)
			{
				keypress(process.stdin);
				process.stdin.on('keypress', this._keypressHandler);
				process.stdin.setRawMode(true);
				process.stdin.resume();
			}
		}

		_shouldDeploy(directory, filename)
		{
			let filePath = path.join(directory, filename);
			let fullDirectory = path.join(process.cwd(), directory);

			// Check if file is in ignore list.
			if(this._filesIgnore.indexOf(filename) !== -1)
			{
				S.utils.sDebug("Skipping ignored file \""+filePath+"\"");
				return false;
			}

			// Check if file extension is supported.
			if(this._fileExtensions.indexOf(path.extname(filename)) === -1)
				return false;

			return true;
		}

		_functionNameResolve(filePath)
		{
			let fileData = S.utils.readFileSync(filePath);
			return fileData.name;
		}

		_functionsInDirectory(directory)
		{
			let _this = this;
			let functionNames = [];

			let globOptions =
			{
				"cwd": directory
			};

			// Find all s-function.json files
			let files = glob.sync("**/s-function.json", globOptions);
			files.forEach(function(file)
			{
				let functionName = _this._functionNameResolve(path.join(directory, file));
				functionNames.push(functionName);

				S.utils.sDebug("Found function named \"" + functionName + "\".");
			});

			return functionNames;
		}

		_functionDeploy(functionNames)
		{
			let _this = this;

			// Options for functionDeploy().
			let options =
			{
				"names": functionNames,
				"stage": _this.evt.options.stage,
				"region": _this.evt.options.region
			};

			return S.actions.functionDeploy(
			{
				"options": options
			});
		}

		_jobQueueStart()
		{
			S.utils.sDebug("_jobQueueStart()");

			// Return immediately if the queue is already running.
			if(this._jobQueueRunning)
				return;

			// Return immediately if the queue is empty.
			if(this._jobQueue.length < 1)
				return;

			// Set the running flag.
			this._jobQueueRunning = true;

			// Process the next job in queue.
			this._jobQueueNext(this);
		}

		_jobQueueNext(_this)
		{
			S.utils.sDebug("_jobQueueNext()");

			// If no job are available.
			if(_this._jobQueue.length < 1)
			{
				S.utils.sDebug("_jobQueue completed.");

				// Set the running flag.
				_this._jobQueueRunning = false;
				return;
			}

			// Get next job.
			let job = _this._jobQueue.shift();

			// Execute job with self as callback.
			job(_this._jobQueueNext);
		}

		_deploy(directory, filename)
		{
			let _this = this;

			let filePath = path.join(directory, filename);
			let changeDirectory = path.join(process.cwd(), directory);

			let context = (filename.endsWith(".json")) ? "endpoint" : "function";
			if(context == "function")
			{
				// Get a list of all function names within the current directory.
				let functionNames = _this._functionsInDirectory(changeDirectory);

				// Remove any function names that are currently deploying.
				_.pullAll(functionNames, _this._currentlyDeploying);

				// If there are no functions to deploy, return.
				if(functionNames.length < 1)
					return;

				// Add the function names to the _currentlyDeploying array.
				_this._currentlyDeploying = _.concat(_this._currentlyDeploying, functionNames);

				// Wait for trigger delay to allow files to settle.
				setTimeout(function()
				{
					// Deploy all functions.
					_this._jobQueue.push(function(callback)
					{
						// Report status.
						SCli.log(chalk.cyan("Detected change in file \"./" + filePath + "\"."));
						SCli.log(chalk.cyan("Deploying functions: " + functionNames.join(", ")));
						SCli.log("");

						// Deploy the functions. Returns promise.
						_this._functionDeploy(functionNames)
						.then(function(data)
						{
							// Report status.
							SCli.log(chalk.green("Deploy completed for functions: " + functionNames.join(", ")));

							// Execute callback which will be mapped to _jobQueueNext().
							callback(_this);
						});
					});
					// Start the queue if it is not already running.
					_this._jobQueueStart();
				}, _this._deployTriggerDelay);
			}
		}

		_addWatcher(directory)
		{
			let _this = this;

			_this._fsWatchers[directory] = fs.watch(directory, _this._fsWatcherOptions, function(event, filename)
			{
				let filePath = path.join(directory, filename);

				S.utils.sDebug(event + " " + filePath);

				if(filename && _this._shouldDeploy(directory, filename))
					_this._deploy(directory, filename);
			});
		}

		_watchStart(directory)
		{
			let _this = this;

			SCli.log("Now monitoring \"" + ((directory.startsWith("./"))?directory:"./"+directory) + "\".");

			// Add subdirectories of current directory.
			var directories = _this._getDirectories(directory);
			for(var i in directories)
			{
				// Check if directory has been ignored.
				if(_this._directoriesIgnore.indexOf(directories[i]) === -1)
					// Check to make sure directory does not start with a ".".
					if(directories[i].indexOf(".") !== 0)
						_this._watchStart(path.join(directory, directories[i]));
			}

			// Add a watcher for the current directory.
			_this._addWatcher(directory);
		}

		/**
		 * POST Hook
		 */

		_hookPost(evt)
		{
			let _this = this;

			return new BbPromise(function(resolve, reject)
			{
				// Remove the completed function names from _currentlyDeploying.
				_.pullAll(_this._currentlyDeploying, evt.options.names);

				// If bell was set, trigger.
				if(_this.evt.options.beep);
					_this._bell();

				return resolve(evt);
			});
		}
	}

	// Export Plugin Class
	return ServerlessChangeMonitorPlugin;
};
