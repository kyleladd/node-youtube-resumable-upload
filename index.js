var fs			= require('fs');
var request		= require('request');
var EventEmitter	= require('events').EventEmitter;
var mime		= require('mime');
var util		= require('util');
//TODO-KL
if (!String.prototype.startsWith) {
	String.prototype.startsWith = function(search, pos) {
		return this.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
	};
}
// https://stackoverflow.com/a/33159592/2000485
Object.defineProperty(Object.prototype, "getProp", {
    value: function (prop) {
        var key,self = this;
        for (key in self) {
            if (key.toLowerCase() == prop.toLowerCase()) {
                return self[key];
            }
        }
    },
    //this keeps jquery happy
    enumerable: false
});
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
  self.getUploadInfo(function(){
    var options = {
      url:  'https://' + self.host + self.api + '?uploadType=resumable&part=snippet,status,contentDetails',
      headers: {
        'Host':     self.host,
        'Authorization':    'Bearer ' + self.tokens.access_token,
        'Content-Length':   new Buffer(JSON.stringify(self.metadata)).length,
        'Content-Type':   'application/json',
        'X-Upload-Content-Length':  self.size,
        'X-Upload-Content-Type': self.type
      },
      body: JSON.stringify(self.metadata)
    };
    //Send request and start upload if success

    //TODO-KL: handle refesh token
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
  });
}

resumableUpload.prototype.getUploadInfo = function(callback){
  var self = this;
  if(self.file.startsWith('http://')||self.file.startsWith('https://')){
    request.head({url:self.file},function(err,response,body){
      self.size = response.headers.getProp("Content-Length");
      self.type = response.headers.getProp("Content-Type");
      callback();
    });
  }
  else {
  	if(typeof self.file === 'string'){
	    self.size = fs.statSync(self.file).size;
	    self.type = mime.lookup(self.file);
	  }
	  callback();
	}
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
    //url path
    if((self.file.startsWith('http://')||self.file.startsWith('https://'))){
    	request.get(self.file).pipe(request.put(options, function(error, response, body) {
			clearInterval(health);
			if (!error) {
				self.emit('success', body);
				return;
			}
      //TODO-KL handle refresh token
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
    }
    else{
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
    }
  }
    catch (e) {
    self.emit('error', new Error(e));
    return;
  }
  var health = setInterval(function(){
		self.getProgress(function(err, res, body) {
			if (!err && typeof res.headers.range !== 'undefined') {
				self.emit('progress', res.headers.range.substring(8));
			}
		});
	}, 5000);
}

resumableUpload.prototype.getProgress = function(handler) {
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