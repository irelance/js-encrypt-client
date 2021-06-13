# install

```bash
npm i js-encrypt-client
```

# usage

Please take a look at [example](./example/client.js)

if your app type is ```Team``` and want to force stop all mission on remote server.
You can use this command:

```
# interactive
npx ijec stopall <remote> <appId>
Press Enter to continue to set <appSecret>:<appSecret>
```

```
# silent
npx ijec stopall <remote> <appId> -s <appSecret>
```

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


# extra

Contact me to apply for ```appId```, ```appSecret```, ```remote``` to test or buy for subscribe service.

email: heirelance11@gmail.com

|      |  Team  |  Business  |
|   ---|  ---  |  ---  |
| price | 500 CNY/month | 1000 CNY/month |
| package in same time | × | √ |
| package limit per month | 20 | no limit |
| extension support | js | js |
| single file size | 0 ~ 5MB | 0 ~ 10MB |
