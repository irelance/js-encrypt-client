# usage

Please take a look at [example](./example/client.js)

# config


- entry (required): the dir to entry on.
- output: the dir to write, replace files if empty.
- remote (required): the remote package machine address
- appId (required): the id for identify project, apply it from me.
- appSecret (required): secret key for appId
- packageAll: default ```true```, 
if is ```true``` all ```.js``` file which on the entry will be encrypt.
if ```false```, only encrypt files on ```dirs``` and ```files``` options
- type: enum('node','browser'), default 'browser', the default type of all files.
- dirs: Array<string name, string type, boolean recursive>, type is the same as type option.
- files: Array<string name, string type>, type is the same as type option.


# priority

files > dirs > entry
