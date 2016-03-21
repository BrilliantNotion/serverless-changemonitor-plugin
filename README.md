Serverless ChangeMonitor Plugin
===

Monitors your project's files and automatically deploys the function when a change is detected.

**Note:** Requires Serverless v0.5.0 or higher.

### Setup

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
