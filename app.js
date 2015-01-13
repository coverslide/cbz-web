'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var url = require('url');

var config = require('config');
var express = require('express');
var Promise = require('bluebird');
var _ = require('lodash')

var promiseWhile = require('./lib/promise-while.js');

var app = express();

var OK = 0;
var ERR = 1;

var EOCD_SIZE = 22;
var CD_SIZE = 46;
var FH_SIZE = 30;

var COMPRESSION_UNCOMPRESSED = 0
var COMPRESSION_DEFLATE = 8;

Promise.promisifyAll(fs)

app.use(handleOrigin);

app.get('/file-list', function (req, res, next) {
    var directory = req.param('directory') || '';
    var dirPath = path.join(config.root, directory);

    fs.readdirAsync(dirPath)
        .map(function (filename) {
            return Promise.join(fs.statAsync(path.join(dirPath, filename)), function (stat) {
                return {
                    directory: stat.isDirectory(),
                    filename: filename,
                    size: stat.size
                }
            })
        }).filter(function (info) {
            return !info.filename.match(/^\./) && (info.directory || info.filename.match(/cbz$/i))
        }).call('sort', function (a, b) {
            if (a.directory != b.directory) {
                return a.directory ? -1 : 1;
            }
            return a.filename.toLowerCase().localeCompare(b.filename.toLowerCase());
        }).then(function (data) {
            respond(res, data, OK, {directory: directory});
        }).error(function (e) {
            next(e);
        });
});

app.get('/comic/list', function (req, res, next) {
    var file = req.param('file') || '';
    var filePath = path.join(config.root, file);
    var fd, stat, eocd, entries = [];

    fs.openAsync(filePath, 'r')
        .then(function (_fd) {
            fd = _fd;
            return fs.fstatAsync(fd);
        }).then(function (_stat) {
            stat = _stat;
            return fs.readAsync(fd, new Buffer(EOCD_SIZE), 0, EOCD_SIZE, stat.size - EOCD_SIZE)
        }).spread(function (length, buffer) {
            //get eocd data
            if (buffer.slice(0,4).toString() !== 'PK\u0005\u0006') {
                throw new Error('Not a zip file');
            }

            eocd = {
                diskNumber: buffer.readUInt16LE(4, true),
                cdDisk: buffer.readUInt16LE(6, true),
                diskEntryCount: buffer.readUInt16LE(8, true),
                entryCount: buffer.readUInt16LE(10, true),
                cdSize: buffer.readUInt32LE(12, true),
                cdOffset: buffer.readUInt32LE(16, true)
            };

            var count = eocd.entryCount;
            var offset = eocd.cdOffset;

            return promiseWhile(function () {
                return count > 0;
            }, function () {
                var deferred = Promise.pending();
                var fileInfo, variableFieldsLength;
                fs.readAsync(fd, new Buffer(CD_SIZE), 0, CD_SIZE, offset)
                    .spread(function (length, buffer) {
                        if (buffer.slice(0,4) != 'PK\u0001\u0002') {
                            throw new Error('Central Directory header not found');
                        }
                        fileInfo = {
                            version: buffer.readUInt16LE(4, true),
                            versionNeeded: buffer.readUInt16LE(6, true),
                            flags: buffer.readUInt16LE(8, true),
                            compressionType: buffer.readUInt16LE(10, true),
                            mtime: buffer.readUInt16LE(12, true),
                            mdate: buffer.readUInt16LE(14, true),
                            crc32: buffer.readUInt32LE(16, true),
                            csize: buffer.readUInt32LE(20, true),
                            usize: buffer.readUInt32LE(24, true),
                            filenameLength: buffer.readUInt16LE(28, true),
                            extraFieldLength: buffer.readUInt16LE(30, true),
                            commentLength: buffer.readUInt16LE(32, true),
                            diskStart: buffer.readUInt16LE(34, true),
                            internalAttr: buffer.readUInt16LE(36, true),
                            externalAttr: buffer.readUInt32LE(38, true),
                            fileOffset: buffer.readUInt32LE(42, true)
                        };
                        offset += CD_SIZE;
                        variableFieldsLength = fileInfo.filenameLength + fileInfo.extraFieldLength + fileInfo.commentLength;
                        return fs.readAsync(fd, new Buffer(variableFieldsLength), 0, variableFieldsLength, offset);
                    }).spread(function (length, buffer) {
                        fileInfo.filename = buffer.slice(0, fileInfo.filenameLength).toString();
                        fileInfo.comment = buffer.slice(fileInfo.filenameLength + fileInfo.extraFieldLength, fileInfo.commentLength).toString();
                        offset += variableFieldsLength;
                        entries.push(fileInfo);
                        count -= 1;
                        deferred.resolve();
                    });
                return deferred.promise;
            });
        }).then(function () {
            fs.close(fd);
            respond(res, entries);
        }).error(function (e) {
            fd && fs.close(fd);
            next(e)
        });
});

app.get('/comic/image', function (req, res, next) {
    var file = req.param('file') || '';
    var offset = +(req.param('offset') || 0);
    var filePath = path.join(config.root, file);
    var fd, fileInfo;

    fs.openAsync(filePath, 'r')
        .then(function (_fd) {
            fd = _fd
            return fs.readAsync(fd, new Buffer(FH_SIZE), 0, FH_SIZE, offset);
        }).spread(function (length, buffer) {
            if (buffer.slice(0, 4).toString() != 'PK\u0003\u0004') {
                throw new Error('File not found');
            }
            fileInfo = {
                versionNeeded: buffer.readUInt16LE(4, true),
                flags: buffer.readUInt16LE(6, true),
                compressionType: buffer.readUInt16LE(8, true),
                mtime: buffer.readUInt16LE(10, true),
                mdate: buffer.readUInt16LE(12, true),
                crc32: buffer.readUInt32LE(14, true),
                csize: buffer.readUInt32LE(18, true),
                usize: buffer.readUInt32LE(22, true),
                filenameLength: buffer.readUInt16LE(26, true), 
                extraFieldLength: buffer.readUInt16LE(28, true), 
            };
            var variableFieldLength = fileInfo.filenameLength + fileInfo.extraFieldLength;
            return fs.readAsync(fd, new Buffer(variableFieldLength), 0, variableFieldLength, offset + FH_SIZE);
        }).spread(function (length, buffer) {
            var filename = buffer.slice(0, fileInfo.filenameLength).toString();
            var headerSize = FH_SIZE + fileInfo.filenameLength + fileInfo.extraFieldLength; 
            var rawStream = fs.createReadStream(null, {
                fd: fd,
                start: offset + headerSize,
                end: offset + headerSize + fileInfo.csize - 1
            });

            if (fileInfo.compressionType == COMPRESSION_UNCOMPRESSED) {
                res.contentType(getMimeType(filename));
                return rawStream.pipe(res)
            } else if (fileInfo.compressionType == COMPRESSION_DEFLATE) {
                res.contentType(getMimeType(filename));
                if (!acceptsEncoding(req, 'gzip')) {
                    res.header('Content-Length', fileInfo.usize);
                    var inflate = zlib.createInflateRaw();
                    rawStream.pipe(inflate);
                    inflate.pipe(res);
                    return;
                }
                var headerBuffer = new Buffer(10)// + cfilename.length + 1)
                headerBuffer.writeUInt16LE(0x8b1f, 0, true)
                headerBuffer.writeUInt8(0x8, 2, true)//compression type deflate
                headerBuffer.writeUInt8(0x0, 3, true)//no filename
                headerBuffer.writeUInt32LE(~~(Date.now() / 1000), 4, true)//timestamp
                headerBuffer.writeUInt8(0x3, 9, true) //OS type unix
                //new Buffer(cfilename).copy(headerBuffer,10)

                var footerBuffer = new Buffer(8)
                footerBuffer.writeUInt32LE(fileInfo.crc32, 0, true)
                footerBuffer.writeUInt32LE(fileInfo.usize, 4, true)

                res.header('Content-Encoding', 'gzip');
                res.write(headerBuffer);

                rawStream.on('data', function(data){
                    res.write(data);
                });
                rawStream.on('end', function () {
                    res.write(footerBuffer);
                    res.end();
                });
                rawStream.resume();
            } else {
                return next(new Error('Unknown compression type'));
            }
        }).error(function (e) {
            fd && fs.close(fd);
            next(e);
        });
});

// Error Handling
app.use(function (err, req, res, next) {
    console.log(err.stack);
    respond(res, {}, ERR, {message: err.message}, 500);
});

function respond (res, data, code, meta, statusCode) {
    data = data || {};
    code = code || OK;
    meta = meta || {};
    statusCode = statusCode || 200;
    res.status(statusCode).json(_.extend(
        {status: code},
        meta,
        {data: data}
    )); 
}

function getMimeType (filename) {
    var extension = filename.toLowerCase().match(/[^\.]+$/);

    if (!extension) {
        return 'application/octet-stream';
    }

    switch (extension[0]) {
        case 'jpeg':
        case 'jpg':
            return 'image/jpeg';
        case 'png':
            return 'image/png';
        case 'bmp':
            return 'image/bmp';
        case 'gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
}

function acceptsEncoding (req, encoding) {
    var acceptedEncodingsValue = req.header('accept-encoding');
    if (!acceptedEncodingsValue) {
        return false;
    }
    var acceptedEncodings = acceptedEncodingsValue.split(/\s*,\s*/g);
    return acceptedEncodings.indexOf(encoding) > -1;
}

function handleOrigin (req, res, next) {
    var origin = req.header('origin');

    if (!origin) {
        return next();
    }

    if (!origin.match(/^https?\:\/\//)) {
        var originParsed = {
            protocol: 'http:',
            host: origin
        };
    } else {
        var originParsed = url.parse(origin);
    }

    var allowedOrigins = config.allowed_origins || [];

    var originOk = allowedOrigins.some(function (allowed) {
        if (allowed === '*') {
            return true;
        }
        if (!allowed.match(/^https?\:\/\//)) {
            var allowedParsed = {
                protocol: originParsed.protocol,
                host: allowed
            };
        } else {
            var allowedParsed = url.parse(allowed);
        }
        return allowedParsed.protocol === originParsed.protocol &&
            allowedParsed.host === originParsed.host;
    });


    if (originOk) {
        res.header('Access-Control-Allow-Origin', origin);
        next();
    } else {
        res.end();
    }
}

if (require.main == module) {
    app.listen(8080, '0.0.0.0')
} else if (GLOBAL.PhusionPassenger) {
    app.listen(0);
}
