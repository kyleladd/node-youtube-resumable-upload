var fs      = require('fs');
var request   = require('request');
var EventEmitter  = require('events').EventEmitter;
var mime    = require('mime');
var util    = require('util');
//TODO-KL Change to promises with bluebirdjs and request-promise
// Add retry wrapper around request post to youtube and getting a new token if the old is expired/invalid
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
  this.byteCount  = 0; //init variables
  this.tokens = {};
  this.file = '';
  this.size = 0;
  this.type = '';
  this.metadata = {};
  this.playlists = [];
  this.retry  = -1;
  this.host = 'www.googleapis.com';
  this.api  = '/upload/youtube/v3/videos';
};

util.inherits(resumableUpload, EventEmitter);

//Init the upload by POSTing google for an upload URL (saved to self.location)
resumableUpload.prototype.upload = function() {
  var self = this;
  self.getUploadInfo(self.startUpload);
}

resumableUpload.prototype.startUpload = function() {
  var self = this;
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
    body: JSON.stringify(self.metadata),
    json:true
  };
  //Send request and start upload if success
  request.post(options, function(err, res, body) {
    if (err || !res.headers.location || res.statusCode === 401) {
      self.emit('error', new Error((res.statusCode === 401 ? body.error.message : err)));
      self.emit('progress', 'Retrying ...');
      if ((self.retry > 0) || (self.retry <= -1)) {
        self.retry--;
        if(res.statusCode === 401){
          self.refreshTokens(self.startUpload);
        }
        else{
          self.startUpload(); // retry
        }
      } else {
        self.emit('error', new Error("Exhausted retry attempts. Status Code: " + res.statusCode + " Error: " + err));
      }
    }
    else{
      self.location = res.headers.location;
      self.send();
    }
  });
}

resumableUpload.prototype.refreshTokens = function(callback){
  var self = this;
    var params = {
      client_id: self.tokens.client_id,
      client_secret: self.tokens.client_secret,
      grant_type: "refresh_token",
      refresh_token: self.tokens.refresh_token
    };
    request.post({url:"https://accounts.google.com/o/oauth2/token", form: params, json:true}, function(err, res, body) {
      self.tokens.access_token = body.access_token;
      callback.bind(self)();
    });
}
resumableUpload.prototype.addVideoToPlaylists = function(video, playlists, callback){
  var self = this;
  var itemsProcessed = [];
  if(!playlists || playlists.length === 0){
    callback.bind(self)();
  }
  else{
    playlists.forEach(function(playlistId, index, array){
      self.addVideoToPlaylist(video, playlistId, function(result) {
        itemsProcessed.push(result);
        if(itemsProcessed.length === array.length) {
          callback.bind(self)(itemsProcessed);
        }
      });
    });
  }
}

resumableUpload.prototype.addVideoToPlaylist = function(video, playlistId, callback){
  var self = this;
  var params = {
                snippet:{
                    playlistId:playlistId,
                    resourceId:
                    {
                        kind: "youtube#video",
                        videoId: video.id
                    }
                }
              };
    request.post({
      url:"https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,status", 
      headers: {
        'Authorization':'Bearer ' + self.tokens.access_token,
        'Content-Length':   new Buffer(JSON.stringify(params)).length,
        'Content-Type': "application/json; charset=UTF-8"
    },body: params, json:true }, function(err, res, body) { // api does not support form, use body
      var result = {};
      if(err){
        result[playlistId] = {succeeded:false,message:err};
      }
      else{
        result[playlistId] = {succeeded:true,message:body};
      }
      callback.bind(self)(result);
    });
}

resumableUpload.prototype.getUploadInfo = function(callback){
  var self = this;
  if(typeof self.file === 'string' && (self.file.startsWith('http://')||self.file.startsWith('https://'))){
    request.head({url:self.file},function(err,response,body){
      if(err || !(200 <= response.statusCode && response.statusCode < 400)){
        self.emit('error', new Error("Error fetching file. Response: " + response.statusCode + " - " + err));
        return;
      }
      self.size = response.headers.getProp("Content-Length");
      self.type = response.headers.getProp("Content-Type");
      if(self.type === "binary/octet-stream"){
        self.type = "application/octet-stream";
      }
      callback.bind(self)();
    });
  }
  else {
    if(typeof self.file === 'string'){
      self.size = fs.statSync(self.file).size;
      self.type = mime.lookup(self.file);
    }
    callback.bind(self)();
  }
}

//Pipes uploadPipe to self.location (Google's Location header)
resumableUpload.prototype.send = function() {
  var self = this;
  var options = {
    url: self.location, //self.location becomes the Google-provided URL to PUT to
    headers: {
      'Authorization':  'Bearer ' + self.tokens.access_token,
      'Content-Length': self.size - self.byteCount,
      'Content-Type': self.type
    }, 
    json:true
  }, uploadPipe;
  try {
    //url path
    if(typeof self.file === 'string' && (self.file.startsWith('http://') || self.file.startsWith('https://'))){
      request.get(self.file).pipe(request.put(options, function(error, response, body) {
      clearInterval(health);
      if (!error) {
        self.emit('progress', "Uploaded file successfully to YouTube");
        self.addVideoToPlaylists(body, self.playlists, function(result){
          self.emit('success', {video:body,playlists:result});
        });
      }
      else{
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
          self.emit('progress', "Uploaded file successfully to YouTube");
          self.addVideoToPlaylists(body, self.playlists, function(result){
            //This should be an object
            self.emit('success', {video:body,playlists:result});
          });
        }
        else{
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
      'Authorization':  'Bearer ' + self.tokens.access_token,
      'Content-Length': 0,
      'Content-Range':  'bytes */' + self.size
    }
  };
  request.put(options, handler);
}

module.exports = resumableUpload;