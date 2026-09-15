'use strict';
/**
 * Audio probing and conversion, built on the ffmpeg/ffprobe binaries that ship
 * with the playable-size-inspector extension (a copy under ./tools also works,
 * as does anything on PATH).
 *
 * Output is written to a temp file first and then moved over the destination,
 * so a failed encode never leaves a half-written clip behind.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { mkdirp } = require('./fsx');

/** Extensions treated as audio when a folder is dropped on the panel. */
const AUDIO_EXTS = ['.mp3', '.ogg', '.wav', '.m4a', '.aac', '.flac', '.opus', '.wma', '.aiff', '.aif'];

/** Formats we can write, with the ffmpeg encoder each one needs. */
const OUTPUT_FORMATS = {
    mp3: { ext: '.mp3', codec: 'libmp3lame', lossy: true, label: 'MP3 (libmp3lame)' },
    ogg: { ext: '.ogg', codec: 'libvorbis', lossy: true, label: 'OGG Vorbis (libvorbis)' },
    opus: { ext: '.opus', codec: 'libopus', lossy: true, label: 'Opus (libopus)' },
    m4a: { ext: '.m4a', codec: 'aac', lossy: true, label: 'M4A / AAC' },
    wav: { ext: '.wav', codec: 'pcm_s16le', lossy: false, label: 'WAV (PCM 16-bit)' },
    flac: { ext: '.flac', codec: 'flac', lossy: false, label: 'FLAC (lossless)' },
};

function binCandidates(exeName) {
    const exe = process.platform === 'win32' ? exeName + '.exe' : exeName;
    return [
        path.join(__dirname, '..', '..', 'tools', 'ffmpeg', exe),
        path.join(__dirname, '..', '..', '..', 'playable-size-inspector', 'tools', 'ffmpeg', exe),
        path.join(__dirname, '..', '..', '..', 'image-resizer', 'tools', 'ffmpeg', exe),
    ];
}

const cache = {};

function findBinary(exeName) {
    if (cache[exeName] !== undefined) {
        return cache[exeName];
    }
    cache[exeName] = null;
    for (const candidate of binCandidates(exeName)) {
        if (fs.existsSync(candidate)) {
            cache[exeName] = candidate;
            return cache[exeName];
        }
    }
    const exe = process.platform === 'win32' ? exeName + '.exe' : exeName;
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
        if (dir && fs.existsSync(path.join(dir, exe))) {
            cache[exeName] = path.join(dir, exe);
            return cache[exeName];
        }
    }
    return cache[exeName];
}

function findFfmpeg() {
    return findBinary('ffmpeg');
}

function findFfprobe() {
    return findBinary('ffprobe');
}

function isAudioFile(file) {
    return AUDIO_EXTS.indexOf(path.extname(file).toLowerCase()) !== -1;
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                reject(new Error((String(stderr || '') || err.message || '').trim().split('\n').slice(-3).join(' ') || 'process failed'));
                return;
            }
            resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

/**
 * Read codec / duration / bitrate / sample rate / channels.
 * Falls back to file size only when ffprobe is unavailable, so the panel still
 * lists the files instead of refusing to show anything.
 */
async function probeAudioFile(file) {
    const bytes = fs.statSync(file).size;
    const base = {
        codec: path.extname(file).replace('.', '').toLowerCase(),
        durationSec: 0,
        bitrateKbps: 0,
        sampleRate: 0,
        channels: 0,
        bytes,
    };

    const ffprobe = findFfprobe();
    if (!ffprobe) {
        return base;
    }

    try {
        const { stdout } = await run(ffprobe, [
            '-v', 'error',
            '-select_streams', 'a:0',
            '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate',
            '-of', 'json',
            file,
        ]);
        const data = JSON.parse(stdout || '{}');
        const stream = (data.streams && data.streams[0]) || {};
        const format = data.format || {};
        const bitrate = Number(stream.bit_rate || format.bit_rate || 0);
        return {
            codec: stream.codec_name || base.codec,
            durationSec: Number(format.duration || 0),
            bitrateKbps: bitrate ? Math.round(bitrate / 1000) : 0,
            sampleRate: Number(stream.sample_rate || 0),
            channels: Number(stream.channels || 0),
            bytes,
        };
    } catch (e) {
        return base;
    }
}

/** Encoder-specific quality flags. */
function qualityArgs(formatKey, options) {
    const format = OUTPUT_FORMATS[formatKey];
    if (!format || !format.lossy) {
        return [];
    }
    // VBR gives a better size/quality trade-off than CBR for short SFX, but the
    // scale differs per encoder, so only mp3/ogg expose it.
    if (options.rateMode === 'vbr' && formatKey === 'mp3') {
        return ['-q:a', String(clamp(options.vbrQuality, 0, 9))];
    }
    if (options.rateMode === 'vbr' && formatKey === 'ogg') {
        return ['-q:a', String(clamp(options.vbrQuality, 0, 10))];
    }
    return ['-b:a', String(clamp(options.bitrateKbps, 8, 512)) + 'k'];
}

function clamp(value, min, max) {
    const n = Number(value);
    if (!isFinite(n)) {
        return min;
    }
    return Math.min(max, Math.max(min, n));
}

/**
 * Convert one file. `options`:
 *   format       - key of OUTPUT_FORMATS
 *   rateMode     - 'cbr' | 'vbr'
 *   bitrateKbps  - for cbr
 *   vbrQuality   - for vbr
 *   sampleRate   - 0 = keep
 *   channels     - 0 = keep, 1 = mono, 2 = stereo
 *   normalize    - apply loudness normalisation
 *   trimSilence  - strip leading/trailing silence
 */
async function convertFile(inputPath, outputPath, options) {
    const ffmpeg = findFfmpeg();
    if (!ffmpeg) {
        throw new Error('ffmpeg was not found (looked in ./tools/ffmpeg, the playable-size-inspector extension, and PATH).');
    }
    const format = OUTPUT_FORMATS[options.format];
    if (!format) {
        throw new Error('unknown output format: ' + options.format);
    }

    const bytesIn = fs.statSync(inputPath).size;
    mkdirp(path.dirname(outputPath));

    const tmp = outputPath + '.tmp-' + process.pid + '-' + Date.now() + format.ext;
    const filters = [];
    if (options.trimSilence) {
        filters.push('silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB');
        filters.push('areverse');
        filters.push('silenceremove=start_periods=1:start_silence=0.05:start_threshold=-50dB');
        filters.push('areverse');
    }
    if (options.normalize) {
        filters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    }

    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath, '-vn', '-map_metadata', '-1'];
    if (filters.length) {
        args.push('-af', filters.join(','));
    }
    if (Number(options.sampleRate) > 0) {
        args.push('-ar', String(options.sampleRate));
    }
    if (Number(options.channels) > 0) {
        args.push('-ac', String(options.channels));
    }
    args.push('-c:a', format.codec);
    args.push.apply(args, qualityArgs(options.format, options));
    args.push(tmp);

    try {
        await run(ffmpeg, args);
        if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
            throw new Error('ffmpeg produced an empty file');
        }
        fs.renameSync(tmp, outputPath);
    } catch (e) {
        try {
            if (fs.existsSync(tmp)) {
                fs.unlinkSync(tmp);
            }
        } catch (cleanupError) {
            /* best effort */
        }
        throw e;
    }

    return { bytesIn, bytesOut: fs.statSync(outputPath).size };
}

function formatBytes(n) {
    const value = Number(n) || 0;
    if (value < 1024) {
        return value + ' B';
    }
    if (value < 1024 * 1024) {
        return (value / 1024).toFixed(1) + ' KB';
    }
    return (value / 1024 / 1024).toFixed(2) + ' MB';
}

function formatDuration(sec) {
    const total = Math.max(0, Math.round(Number(sec) || 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
}

module.exports = {
    AUDIO_EXTS,
    OUTPUT_FORMATS,
    isAudioFile,
    findFfmpeg,
    findFfprobe,
    probeAudioFile,
    convertFile,
    formatBytes,
    formatDuration,
};
