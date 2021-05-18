const path = require('path');
const {encrypt} = require('../index');
const config = {
    entry: path.resolve(__dirname, 'src'),
    output: path.resolve(__dirname, 'dist'),
    remote: 'http://192.168.124.11:3000',
    appId: 'test',
    appSecret: 'test',
};

encrypt(config);
