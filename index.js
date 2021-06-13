const path = require('path');
const fs = require('fs');
const os = require('os');
const JSZip = require("jszip");
const crypto = require('crypto');
const got = require('got');

function onEnd(remote, appId, token) {
    return got.post(`${remote}/encrypt/end`, {
        headers: {
            'app-id': appId,
            token,
        },
    });
}

const STEP = {
    START: 0,
    TOKEN: 1,
    CREATE_HASH: 2,
    UPLOADED: 3,
    ENCRYPT_START: 4,
    FINISH: 5,
    DOWNLOADED: 6,
    ERROR: 7,
};

const CACHE_ROOT = path.resolve(os.homedir(), '.js-encrypt-client');
if (!fs.existsSync(CACHE_ROOT)) fs.mkdirSync(CACHE_ROOT);
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
    } else if (state.isDirectory()) {
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
        let cacheHash = crypto.createHash('sha256').update(config.entry).digest().toString('hex');
        const cacheConfigFile = path.resolve(CACHE_ROOT, `${config.appId}-${cacheHash}`);

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
        let filesHash = {};
        Object.entries(itemMap).forEach(([filepath, item]) => {
            const content = fs.readFileSync(filepath);
            zip.file(item.name, content);
            filesHash[filepath] = crypto.createHash('sha1').update(content).digest().toString('hex');
        });

        let token;
        zip.generateAsync({//设置压缩格式，开始打包
            type: "nodebuffer",//nodejs用
            compression: "DEFLATE",//压缩算法
            compressionOptions: {//压缩级别
                level: 9
            }
        })
            .then(async function (content) {//Buffer
                const fileHash = crypto.createHash('sha1').update(content).digest('hex');
                let cacheConfig;
                if (fs.existsSync(cacheConfigFile)) {
                    try {
                        cacheConfig = JSON.parse(fs.readFileSync(cacheConfigFile).toString('utf-8'));
                    } catch {
                    }
                }
                if (!cacheConfig) cacheConfig = {
                    step: STEP.START,
                };
                let isNew = true;
                if (cacheConfig.step > STEP.START) {
                    const tmp = Object.entries(filesHash);
                    if ('object' === typeof cacheConfig.filesHash && Object.entries(cacheConfig.filesHash).length === tmp.length) {
                        isNew = tmp.filter(i => cacheConfig.filesHash[i[0]] !== i[1]).length > 0;
                    }
                }
                if (!cacheConfig.token) isNew = true;//no token must be new mission
                if (!isNew) {
                    //send check token to verify if expired, if expired isNew=true and send end
                    const onState = await got.post(`${config.remote}/encrypt/token/state`, {
                        headers: {
                            'app-id': config.appId,
                            token: cacheConfig.token,
                        },
                        responseType: 'json'
                    });
                    if (200 !== onState.statusCode || 0 !== onState.body.code) {
                        await onEnd(config.remote, config.appId, cacheConfig.token);
                        isNew = true;
                    }
                }
                if (isNew) {
                    cacheConfig.step = STEP.START;
                    cacheConfig.hash = fileHash;
                    cacheConfig.size = content.length;
                }

                if (isNew) {
                    const getToken = await got.post(`${config.remote}/encrypt/getToken`, {
                        headers: {
                            'app-id': config.appId,
                            'app-secret': config.appSecret,
                        },
                        responseType: 'json'
                    });
                    if (200 !== getToken.statusCode) throw new Error(`no token, with HTTP statusCode: ${getToken.statusCode}`);
                    if (0 !== getToken.body.code || !getToken.body.data || !getToken.body.data.token) throw new Error(`no token, code: ${getToken.body.code}`);
                    cacheConfig.token = getToken.body.data.token;
                    cacheConfig.step = STEP.TOKEN;
                    cacheConfig.filesHash = filesHash;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
                //生成上传任务
                token = cacheConfig.token;
                const total = Math.ceil(content.length / chunkSize);
                if (cacheConfig.step === STEP.TOKEN) {
                    const onCreate = await got.post(`${config.remote}/upload/create`, {
                        headers: {
                            'app-id': config.appId,
                            token,
                        },
                        json: {
                            hash: fileHash,
                            size: content.length,
                            chunkSize,
                            total,
                        },
                        responseType: 'json'
                    });
                    if (200 !== onCreate.statusCode || 0 !== onCreate.body.code) throw new Error('create failed');
                    cacheConfig.step = STEP.CREATE_HASH;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
                //上传
                if (cacheConfig.step === STEP.CREATE_HASH) {
                    let current = cacheConfig.current || 0;
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
                            if (tries > chunkMaxTry) {
                                if (200 !== onChunk.statusCode) throw new Error(`chunk failed, with HTTP statusCode: ${onChunk.statusCode}`);
                                throw new Error(`chunk failed, code: ${onChunk.body.code}`);
                            }
                            if (2 === onChunk.body.code) current = onChunk.body.data.current;
                            tries++;
                            continue;
                        }
                        current = onChunk.body.data.current;
                        cacheConfig.current = current;
                        fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                    }
                    cacheConfig.step = STEP.UPLOADED;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
                //打包
                if (cacheConfig.step === STEP.UPLOADED) {
                    const onEncrypt = await got.post(`${config.remote}/encrypt/start`, {
                        headers: {
                            'app-id': config.appId,
                            token,
                        },
                        responseType: 'json'
                    });
                    if (200 !== onEncrypt.statusCode || 0 !== onEncrypt.body.code) throw new Error('encrypt failed on start');
                    cacheConfig.step = STEP.ENCRYPT_START;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
                //检测
                if (cacheConfig.step === STEP.ENCRYPT_START) {
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
                    cacheConfig.step = STEP.FINISH;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
                //下载
                if (cacheConfig.step === STEP.FINISH) {
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
                    cacheConfig.step = STEP.DOWNLOADED;
                    fs.writeFileSync(cacheConfigFile, JSON.stringify(cacheConfig));
                }
            })
            .catch(e => {
                console.error(e);
                reject(e);
            })
            .finally(() => {
                onEnd(config.remote, config.appId, token);
                if (fs.existsSync(cacheConfigFile)) fs.unlinkSync(cacheConfigFile);
            });
    });
}

module.exports = {encrypt};
