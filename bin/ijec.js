#!/usr/bin/env node
const {Command} = require('commander');
const readline = require('readline');

function readSyncByRl(tips) {
    tips = tips || '> ';

    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(tips, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

const program = new Command();
program
    .storeOptionsAsProperties(false)
    //.passCommandToAction(false)
    .name('ijec')
    .version('1.0.0', '-v, --version');

program
    .command('stopall')
    .arguments('<remote> [appId]')
    .option('-s, --secret [appSecret]', 'pass app secret silently', '')
    .description('stop all your <appId> package with <appSecret> on <remote>')
    .action(async (remote, appId, options) => {
        let url = new URL(remote);
        appId = appId || url.username;
        if (!appId) {
            appId = await readSyncByRl('Press Enter to continue to set <appId>:');
        }
        if (!appId) throw new Error('<appId> is required!');
        let appSecret = options.secret || url.password;
        if (!appSecret) {
            appSecret = await readSyncByRl('Press Enter to continue to set <appSecret>:');
        }
        if (!appSecret) throw new Error('<appSecret> is required!');
        url.username = '';
        url.password = '';
        url.pathname = '/encrypt/stopAll';
        const onStopAll = await fetch(url.toString(), {
            method: 'post',
            headers: {
                'app-id': appId,
                'app-secret': appSecret,
            }
        });
        const body= await onStopAll.json()
        if (200 !== onStopAll.status) throw new Error(`stopAll failed with HTTP statusCode: ${onStopAll.status}`);
        if (0 !== body.code) throw new Error(`stopAll failed with code: ${body.code}`);
        console.log('ok!');
    });

program.parse(process.argv);
