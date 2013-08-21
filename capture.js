if (!Date.prototype.toISOString) {
    Date.prototype.toISOString = function () {
        function pad(n) {
            return n < 10 ? '0' + n : n;
        }

        function ms(n) {
            return n < 10 ? '00' + n : n < 100 ? '0' + n : n
        }

        return this.getFullYear() + '-' +
            pad(this.getMonth() + 1) + '-' +
            pad(this.getDate()) + 'T' +
            pad(this.getHours()) + ':' +
            pad(this.getMinutes()) + ':' +
            pad(this.getSeconds()) + '.' +
            ms(this.getMilliseconds()) + 'Z';
    }
}

function readArray(filename) {
    var fs = require('fs');

    filedata = fs.read(filename);
    arrdata = filedata.split(/[\r\n]/);
    delete fs;

    return arrdata.filter(function (v) {
        return v !== ''
    });
}

function writeFile(filename, str) {
    fs = require('fs');

    var f = null;
    try {
        f = fs.open(filename, "w");
        f.write(str);
    } catch (e) {
        console.log(e);
    }
    if (f) {
        f.close();
    }

    delete fs;
}

function createHAR(address, title, startTime, endTime, resources) {
    var entries = [];

    resources.forEach(function (resource) {
        var request = resource.request,
            startReply = resource.startReply,
            endReply = resource.endReply;

        if (!request || !startReply || !endReply) {
            return;
        }

        // Exclude Data URI from HAR file because
        // they aren't included in specification
        if (request.url.match(/(^data:image\/.*)/i)) {
            return;
        }

        entries.push({
            startedDateTime: request.time.toISOString(),
            time: endReply.time - request.time,
            request: {
                method: request.method,
                url: request.url,
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: request.headers,
                queryString: [],
                headersSize: -1,
                bodySize: -1
            },
            response: {
                status: endReply.status,
                statusText: endReply.statusText,
                httpVersion: "HTTP/1.1",
                cookies: [],
                headers: endReply.headers,
                redirectURL: "",
                headersSize: -1,
                bodySize: startReply.bodySize,
                content: {
                    size: startReply.bodySize,
                    mimeType: endReply.contentType
                }
            },
            cache: {},
            timings: {
                blocked: 0,
                dns: -1,
                connect: -1,
                send: 0,
                wait: startReply.time - request.time,
                receive: endReply.time - startReply.time,
                ssl: -1
            },
            pageref: address
        });
    });

    return {
        log: {
            version: '1.2',
            creator: {
                name: "PhantomJS",
                version: phantom.version.major + '.' + phantom.version.minor +
                    '.' + phantom.version.patch
            },
            pages: [
                {
                    startedDateTime: startTime.toISOString(),
                    id: address,
                    title: title,
                    pageTimings: {
                        onLoad: endTime - startTime
                    }
                }
            ],
            entries: entries
        }
    };
}

function fetchPage(url) {
    var page = require('webpage').create();

    var now = new Date();

    page.address = url;

    page.viewportSize = { width: 1280, height: 3000 };

    page.resources = [];

    page.onLoadStarted = function () {
        page.startTime = new Date();
    };

    page.onResourceRequested = function (req) {
        page.resources[req.id] = {
            request: req,
            startReply: null,
            endReply: null
        };
    };

    page.onResourceReceived = function (res) {
        if (res.stage === 'start') {
            page.resources[res.id].startReply = res;
        }
        if (res.stage === 'end') {
            page.resources[res.id].endReply = res;
        }
    };

    page.open(page.address, function (status) {
        console.log(" ---------- url : " + page.address);

        if (status !== 'success') {
            console.log('FAIL to load the address');
        } else {
            page.endTime = new Date();
            var t = page.endTime - page.startTime;

            page.title = page.evaluate(function () {
                return document.title;
            });

            har = createHAR(page.address, page.title, page.startTime, page.endTime, page.resources);
            // print Json HAR
            // console.log(JSON.stringify(har, undefined, 4));

            // print image information
            var cntImages = 0,
                sizeImages = 0;

            for (var v in har.log.entries) {
                if (har.log.entries[v].request.url.search(new RegExp(/.jpg|.jpeg|.gif|.png/i)) != -1) {
                    cntImages++;
                    sizeImages += har.log.entries[v].response.bodySize;

                    if (har.log.entries[v].response.bodySize > 150 * 1024) {    // 150K over image
                        console.log("large size image url : " + har.log.entries[v].request.url + " , size : " + har.log.entries[v].response.bodySize);
                    }
                }
            }
            console.log("# of images : " + cntImages + " , image sizes : " + sizeImages);

            var label = page.address.match(/http\:\/\/(.*(\?.*|))/)[1].replace(/\//g, ".").substring(0,100); // max 100 char.
            var filename = [ label, "D" + t ].join(".");

            // for windows
            filename = filename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();

            console.log(label + ': Loading time ' + t + ' msec');
            page.render(filename + ".png");
            writeFile(filename + ".har", JSON.stringify(har, undefined, 4));

            count++;
            delete page;
        }
    });
}


function waitFor(testFx, onReady, timeOutMillis) {
    var maxtimeOutMillis = timeOutMillis ? timeOutMillis : 10000, //< Default Max Timout is 10s
        start = new Date().getTime(),
        condition = false,
        interval = setInterval(function () {
            if ((new Date().getTime() - start < maxtimeOutMillis) && !condition) {
                // If not time-out yet and condition not yet fulfilled
                condition = (typeof(testFx) === "string" ? eval(testFx) : testFx()); //< defensive code
            } else {
                if (!condition) {
                    // If condition still not fulfilled (timeout but condition is 'false')
                    console.log(" timeout");
                    phantom.exit(1);
                } else {
                    // Condition fulfilled (timeout and/or condition is 'true')
                    console.log(" finished in " + (new Date().getTime() - start) + "ms.");
                    typeof(onReady) === "string" ? eval(onReady) : onReady(); //< Do what it's supposed to do once the condition is fulfilled
                    clearInterval(interval); //< Stop this interval
                }
            }
        }, 100); //< repeat check every 100ms
};


///////////////////////////////////////
//
//    capture.js
//
///////////////////////////////////////
var system = require('system');
var count = 0;

if (system.args.length === 1) {
    console.log('Usage: capture.js [filename]');
    phantom.exit();
}

var t_start = new Date().getTime();
var arrayOfUrls = readArray(system.args[1]);

console.log('-----------  total urls : ' + arrayOfUrls.length + '  -----------------')

arrayOfUrls.forEach(function (url) {
    fetchPage(url);
});

waitFor(function () {
        return count === arrayOfUrls.length;
    },
    function () {
        console.log("total finished in " + (new Date().getTime() - t_start) + "ms.");
        phantom.exit();
    },
    arrayOfUrls.length * 5000
);
