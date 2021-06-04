const path = require('path');
const fs = require('fs');
const JSZip = require("jszip");
const crypto = require('crypto');
const got = require('got');

const chunkSize = 5242880;
const chunkMaxTry = 5;

const TYPE = {
    BROWSER: 'browser',
    NODE: 'node',
};


function isType(type) {
    return function (obj) {
        return Object.prototype.toString.call(obj) === '[object ' + type + ']';
    }
}

const isArray = isType('Array');

function appendItem(itemMap, entry, filePath, type, recursive) {
    if (TYPE.NODE !== type) type = TYPE.BROWSER;
    if (!fs.existsSync(filePath)) return;
    let state = fs.statSync(filePath);
    if (state.isFile()) {
        if ('.js' === path.extname(filePath)) {
            let name = path.relative(entry, filePath);
            name = name.replace(/\\/g, '/');
            itemMap[filePath] = {name, type};
        }
        //是文件
    } else if (state.isDirectory()) {
        //是文件夹
        //先读取
        let files = fs.readdirSync(filePath);
        files.forEach(file => {
            const childPath = path.join(filePath, file);
            if (!recursive) {
                const state = fs.statSync(childPath);
                if (state.isDirectory()) return;
            }
            appendItem(itemMap, entry, childPath, type, recursive);
        });
    }
}

function configWithDefault(config) {
    if (!config.entry) throw new Error('config.entry is not defined!');
    if (!config.remote) throw new Error('config.remote is not defined!');
    if (!config.appId) throw new Error('config.appId is not defined!');
    if (!config.appSecret) throw new Error('config.appSecret is not defined!');
    if (!config.output) config.output = config.entry;
    if ('boolean' !== typeof config.packageAll) config.packageAll = true;
    if (TYPE.NODE !== config.type) config.type = TYPE.BROWSER;
    if (!isArray(config.dirs)) config.dirs = [];
    if (!isArray(config.files)) config.files = [];
    return config;
}

function encrypt(config) {
    return new Promise((resolve, reject) => {
        config = configWithDefault(config);

        let itemMap = {};

        if (config.packageAll) {
            appendItem(itemMap, config.entry, config.entry, config.type, true);
        }
        config.dirs.forEach(dir => {
            appendItem(itemMap, config.entry, dir.name, dir.type, dir.recursive);
        });

        config.files.forEach(file => {
            appendItem(itemMap, config.entry, file.name, file.type, false);
        });

        let configJson = {};
        configJson.items = Object.entries(itemMap).map(([k, v]) => v);
        let zip = new JSZip();

        zip.file('config.json', Buffer.from(JSON.stringify(configJson)));
        Object.entries(itemMap).forEach(([filepath, item]) => {
            zip.file(item.name, fs.readFileSync(filepath))
        });

        zip.generateAsync({//设置压缩格式，开始打包
            type: "nodebuffer",//nodejs用
            compression: "DEFLATE",//压缩算法
            compressionOptions: {//压缩级别
                level: 9
            }
        })
            .then(async function (content) {//Buffer
                const getToken = await got.post(`${config.remote}/encrypt/getToken`, {
                    headers: {
                        'app-id': config.appId,
                        'app-secret': config.appSecret,
                    },
                    responseType: 'json'
                });
                if (200 !== getToken.statusCode || 0 !== getToken.body.code || !getToken.body.data || !getToken.body.data.token) throw new Error('no token');
                //生成上传任务
                const token = getToken.body.data.token;
                const total = Math.ceil(content.length / chunkSize);
                const onCreate = await got.post(`${config.remote}/upload/create`, {
                    headers: {
                        'app-id': config.appId,
                        token,
                    },
                    json: {
                        hash: crypto.createHash('sha1').update(content).digest('hex'),
                        size: content.length,
                        chunkSize,
                        total,
                    },
                    responseType: 'json'
                });
                if (200 !== onCreate.statusCode || 0 !== onCreate.body.code) throw new Error('create failed');
                //上传
                let current = 0;
                let tries = 0;
                while (current < total) {
                    const begin = current * chunkSize;
                    const end = Math.min(begin + chunkSize, content.length);
                    const chunk = content.slice(begin, end);
                    const onChunk = await got.post(`${config.remote}/upload/chunk`, {
                        headers: {
                            'app-id': config.appId,
                            'chunk-id': current,
                            'hash': crypto.createHash('md5').update(chunk).digest('hex'),
                            token,
                            'content-type': 'application/octet-stream',
                        },
                        body: chunk,
                        responseType: 'json'
                    });
                    if (200 !== onChunk.statusCode || 0 !== onChunk.body.code) {
                        if (tries > chunkMaxTry) throw new Error('chunk failed');
                        tries++;
                        continue;
                    }
                    current = onChunk.body.data.current;
                }
                //打包
                const onEncrypt = await got.post(`${config.remote}/encrypt/start`, {
                    headers: {
                        'app-id': config.appId,
                        token,
                    },
                    responseType: 'json'
                });
                if (200 !== onEncrypt.statusCode || 0 !== onEncrypt.body.code) throw new Error('encrypt failed on start');
                //检测
                let process = 0;
                let finish = false;
                let timeout = 2000;
                while (!finish) {
                    await new Promise(r => setTimeout(r, timeout));
                    const onState = await got.post(`${config.remote}/encrypt/state`, {
                        headers: {
                            'app-id': config.appId,
                            token,
                        },
                        responseType: 'json'
                    });
                    if (200 !== onState.statusCode || 0 !== onState.body.code) throw new Error('encrypt failed on pending');
                    process = onState.body.data.process;
                    finish = onState.body.data.finish;
                    console.log(`process: ${process}%`);
                }
                //下载
                console.log('downloading...');
                const onDownload = await got.post(`${config.remote}/encrypt/download`, {
                    headers: {
                        'app-id': config.appId,
                        token,
                    },
                    responseType: 'buffer'
                });
                if (200 !== onDownload.statusCode) throw new Error('download failed');
                //解压
                JSZip.loadAsync(onDownload.body)
                    .then(zip => {
                        const files = zip.files;
                        const basepath = config.output;
                        if (!fs.existsSync(basepath)) fs.mkdirSync(basepath);
                        let jobs = [];
                        for (const filename of Object.keys(files)) {
                            const dest = path.join(basepath, filename);
                            if (files[filename].dir) fs.mkdirSync(dest, {recursive: true});
                            else jobs.push(files[filename].async('nodebuffer').then(content => {
                                const parentDir = path.dirname(dest);
                                if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, {recursive: true});
                                fs.writeFileSync(dest, content)
                            }));
                        }
                        return Promise.all(jobs);
                    })
                    .then(() => {
                        console.log('finish.');
                        resolve();
                    });
                //
                await got.post(`${config.remote}/encrypt/end`, {
                    headers: {
                        'app-id': config.appId,
                        token,
                    },
                });
            })
            .catch(e => {
                console.error(e);
                reject(e);
            });
    });
}

module.exports = {encrypt};
