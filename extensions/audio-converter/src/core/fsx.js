'use strict';
/** Small fs helpers that also work on old Node versions. */

const fs = require('fs');
const path = require('path');

function mkdirp(dir) {
    if (!dir || fs.existsSync(dir)) {
        return;
    }
    mkdirp(path.dirname(dir));
    try {
        fs.mkdirSync(dir);
    } catch (e) {
        if (e.code !== 'EEXIST') {
            throw e;
        }
    }
}

function rmrf(target) {
    if (!fs.existsSync(target)) {
        return;
    }
    if (fs.statSync(target).isDirectory()) {
        for (const name of fs.readdirSync(target)) {
            rmrf(path.join(target, name));
        }
        fs.rmdirSync(target);
    } else {
        fs.unlinkSync(target);
    }
}

module.exports = { mkdirp, rmrf };
