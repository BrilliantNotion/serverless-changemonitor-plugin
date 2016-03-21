Serverless Change Monitor Plugin
===

Monitors your project's files and automatically deploys the function when a change is detected.

**Note:** Requires Serverless v0.5.0 or higher.

Setup
===

* Install via npm in the root of your Serverless Project:
```
npm install serverless-changemonitor-plugin --save
```

* Add the plugin to the `plugins` array in your Serverless Project's `s-project.json`, like this:

```
plugins: [
    "serverless-changemonitor-plugin"
]
```

* Enter the folder you're working on, and start the change monitor from the command line:

```
cd project/folder/where/you/are/working
sls changemonitor deploy -b
```

* All done!

Common Pitfalls
===

### Beep Does Not Work

On some systems the beep will not sound after deployment. (Ubuntu Linux being a known offender.) This is because the PC speaker sound has been disabled on the system by default. In order for the beep to work, it must be enabled. 

* [Ask Ubuntu: Getting the PC speaker to beep](http://askubuntu.com/questions/96511/getting-the-pc-speaker-to-beep)

