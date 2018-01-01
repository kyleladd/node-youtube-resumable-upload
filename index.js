var fs			= require('fs');
var request		= require('request');
var EventEmitter	= require('events').EventEmitter;
var mime		= require('mime');
var util		= require('util');

function resumableUpload() {
	this.byteCount	= 0; //init variables
	this.tokens	= {};
  this.file = '';
  this.size = 0;
  this.type = '';
	this.metadata	= {};
	this.retry	= -1;
	this.host	= 'www.googleapis.com';
	this.api	= '/upload/youtube/v3/videos';
};

util.inherits(resumableUpload, EventEmitter);

//Init the upload by POSTing google for an upload URL (saved to self.location)
resumableUpload.prototype.upload = function() {
	var self = this;

  // file path
  if(typeof this.file === 'string'){
    this.type = fs.statSync(this.file).size;
    this.size = mime.lookup(this.file);
  }

	var options = {
		url:	'https://' + self.host + self.api + '?uploadType=resumable&part=snippet,status,contentDetails',
		headers: {
		  'Host':			self.host,
		  'Authorization':		'Bearer ' + self.tokens.access_token,
		  'Content-Length':		new Buffer(JSON.stringify(self.metadata)).length,
		  'Content-Type':		'application/json',
		  'X-Upload-Content-Length':	this.size,
		  'X-Upload-Content-Type': this.type
		},
		body: JSON.stringify(self.metadata)
	};
	//Send request and start upload if success
	request.post(options, function(err, res, body) {
		if (err || !res.headers.location) {
			self.emit('error', new Error(err));
			self.emit('progress', 'Retrying ...');
			if ((self.retry > 0) || (self.retry <= -1)) {
				self.retry--;
				self.upload(); // retry
			} else {
				return;
			}
		}
		self.location = res.headers.location;
		self.send();
	});
}

//Pipes uploadPipe to self.location (Google's Location header)
resumableUpload.prototype.send = function() {
	var self = this;
	var options = {
		url: self.location, //self.location becomes the Google-provided URL to PUT to
		headers: {
		  'Authorization':	'Bearer ' + self.tokens.access_token,
		  'Content-Length': self.size - self.byteCount,
		  'Content-Type':	self.type
		}
	}, uploadPipe;
	try {
    // file path
    if(typeof self.file === 'string'){
      //creates file stream, pipes it to self.location
      uploadPipe = fs.createReadStream(self.file, {
        start: self.byteCount,
        end: self.size
      });
    }
    else{ // already a readable stream
      uploadPipe = self.file;
    }

		self.getProgress(function(err, res, body) {
			if (!err && typeof res.headers.range !== 'undefined') {
				self.emit('progress', res.headers.range.substring(8));
			}
		});
	}, 5000);
	uploadPipe.pipe(request.put(options, function(error, response, body) {
		clearInterval(health);
		if (!error) {
			self.emit('success', body);
			return;
		}
		self.emit('error', new Error(error));
		if ((self.retry > 0) || (self.retry <= -1)) {
			self.retry--;
			self.getProgress(function(err, res, b) {
				if (typeof res.headers.range !== 'undefined') {
					self.byteCount = res.headers.range.substring(8); //parse response
				} else {
					self.byteCount = 0;
				}
				self.send();
			});
		}
	}));
var healthCheckInterval = null;

//PUT every 5 seconds to get partial # of bytes uploaded
resumableUpload.prototype.startMonitoring = function() {
	var self = this;
	var options = {
		url: self.location,
		headers: {
		  'Authorization':	'Bearer ' + self.tokens.access_token,
		  'Content-Length':	0,
		  'Content-Range':	'bytes */' + self.size
		}
	};
	var healthCheck = function() { //Get # of bytes uploaded
		request.put(options, function(error, response, body) {
			if (!error && response.headers.range != undefined) {
        if(!!response.headers.range){
  				self.emit('progress', response.headers.range.substring(8, response.headers.range.length) + '/' + self.size);
        }
        else{
          self.emit('progress', response.headers);
        }
				if (response.headers.range == self.size) {
					clearInterval(healthCheckInteral);
				}
			}
		});
	};
	healthCheckInterval = setInterval(healthCheck, 5000);
}

resumableUpload.prototype.clearIntervals = function(){
  console.log('clearing intervals');
  clearInterval(healthCheckInterval);
};

	var self = this;
	var options = {
		url: self.location,
		headers: {
		  'Authorization':	'Bearer ' + self.tokens.access_token,
		  'Content-Length':	0,
		  'Content-Range':	'bytes */' + self.size
		}
	};
	request.put(options, handler);
}

module.exports = resumableUpload;
