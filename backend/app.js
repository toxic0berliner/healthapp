// Copyright 2015-2016, Google, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// [START app]
'use strict';

var config = require('./config.json');

var Queue = require('firebase-queue');
var firebase = require('firebase');
firebase.initializeApp({
  serviceAccount: config.service_account,
  databaseURL: config.database_url
});

var express = require('express');
var bodyParser = require('body-parser');

var app = express();
app.use(bodyParser.urlencoded({ extended: false }));


app.get('/', function (req, res) {
  res.status(200).send('Hello, world!');
});

app.get("/callback", (req, res) => {
  var task_id=req.param('task_id')
  var oauth_userid=req.param('userid')
  var oauth_token=req.param('oauth_token')
  var oauth_verifier=req.param('oauth_verifier')

  var taskRef = firebase.database().ref('queue/tasks/'+task_id);
  taskRef.update({
    "oauth_token":oauth_token,
    "oauth_verifier":oauth_verifier,
    "oauth_userid":oauth_userid,
    "_state":"user_callback_finished",
    "notification_body":{"appli":1,"userid":oauth_userid}
  }).then(function(){
    //res.send('user_callback_finished for userid='+this);
    res.redirect(config.application_callback_url)
  })
})

app.post("/notification", (req, res) => {
  var taskRef = firebase.database().ref('queue/tasks').push();
  taskRef.set({"_state":"withings_notification_recieved","notification_body":req.body}).then(function(){
      res.send('OK');
  })
})

app.get("/fakenotification", (req, res) => {
  var taskRef = firebase.database().ref('queue/tasks').push();
  taskRef.set({"_state":"withings_notification_recieved","notification_body":{"appli":1,"userid":req.param('userid')}}).then(function(){
      res.send('OK');
  })
})

app.get("/healthcheck", (req, res) => {
    res.send('OK');
})

app.get("/versioncheck", (req, res) => {
    res.send('1.0.10');
})


// Start the server
var server = app.listen(process.env.PORT || '8080', function () {
  console.log('App listening on port %s', server.address().port);
  console.log('Press Ctrl+C to quit.');
});

var queueRef = firebase.database().ref('queue');

// let's start our queue to compute the url we need to redirect the user to:
var optionsComputeOauth = {
  'specId': 'compute_oauth_redirect',
  'sanitize': false
};
var queueRef = firebase.database().ref('queue');
var computeOauthRedirectQueue = new Queue(queueRef, optionsComputeOauth, function(data, progress, resolve, reject) {

  var withings = require("withings-oauth2/dist/Withings").Withings
  var options = {
        consumerKey: config.withings_apikey,
        consumerSecret: config.withings_apisecret,
        callbackUrl: config.withings_callback_url+"?task_id="+data._id
  };
  var client = new withings(options)

  client.getRequestTokenAsync().then(function(token){
    data.oauth_token=token.token;
    data.oauth_token_secret=token.tokenSecret;
    var redirectUrl=client.authorizeUrl(token.token, token.tokenSecret)
    data.oauth_redirect_url=redirectUrl;
    resolve(data);
  })
});

// let's start a second queue to fanout the computed url
var fanoutOauthRedirectOptions = {
  'specId': 'fanout_oauth_redirect'
};
var fanoutOauthRedirectQueue = new Queue(queueRef, fanoutOauthRedirectOptions, function(data, progress, resolve, reject) {
  // fan data out to /messages; ensure that errors are caught and cause the task to fail
  var usersRef = firebase.database().ref('users');
  var theUser = usersRef.child(data.user)
  var oauth= {
      //token: data.oauth_token,
      //token_secret: data.oauth_token_secret,
      redirect_url: data.oauth_redirect_url
    }
  theUser.update({'withings_oauth':oauth});
  resolve(data);
});

// the user will then browse to the provided oauth_redirect_url
// after granting access in th whithings website, he will be forwarded to our callback url
// at which point the task will be completed with the oauth verifyer and token and change to state user_callback_finished
// let's start a third queue to listen to these tasks :
// let's start a second queue to fanout the computed url
var computeOauthAccessTokenOptions = {
  'specId': 'compute_oauth_access_token',
  'sanitize': true
};
var computeOauthAccessTokenQueue = new Queue(queueRef, computeOauthAccessTokenOptions, function(data, progress, resolve, reject) {
  // fan data out to /messages; ensure that errors are caught and cause the task to fail
  var withings = require("withings-oauth2/dist/Withings").Withings
  var options = {
        consumerKey: config.withings_apikey,
        consumerSecret: config.withings_apisecret,
        callbackUrl: config.withings_callback_url+"?task_id="+data._id
  };
  var client = new withings(options)

  client.getAccessTokenAsync(data.oauth_token, data.oauth_token_secret, data.oauth_verifier).then(function(token){
    data.oauth_access_token=token.token;
    data.oauth_access_token_secret=token.tokenSecret;
    resolve(data);
  })
});

// finally let's start our last queue that will fanout the final access token to the user
var fanoutOauthAccessTokenOptions = {
  'specId': 'fanout_oauth_access_token'
};
var fanoutOauthAccessTokenQueue = new Queue(queueRef, fanoutOauthAccessTokenOptions, function(data, progress, resolve, reject) {
  // fan data out to /messages; ensure that errors are caught and cause the task to fail
  var usersRef = firebase.database().ref('users');
  var theUser = usersRef.child(data.user)
  var oauth= {
      token: data.oauth_access_token,
      token_secret: data.oauth_access_token_secret,
      user_id:data.oauth_userid
    }
  theUser.update({'withings_oauth':oauth});
  resolve(data);
});

// let's start our queue to get the measures
var optionsGetMeasures = {
  'specId': 'get_measures',
};
var queueRef = firebase.database().ref('queue');
var getMeasuresQueue = new Queue(queueRef, optionsGetMeasures, function(data, progress, resolve, reject) {

  var withings = require("withings-oauth2/dist/Withings").Withings
  var options = {
        consumerKey: config.withings_apikey,
        consumerSecret: config.withings_apisecret,
        accessToken: data.withings_oauth.token,
        accessTokenSecret: data.withings_oauth.token_secret,
        userID: data.withings_oauth.user_id
    };
  var client = new withings(options)

  var params = {
        //startdate: moment(startDate).unix(),
        //enddate: moment(endDate).unix(),
        //meastype: measType,
        category:1
    };
  client.getAsync('measure', 'getmeas', params).then(function(measures){
    data.measures=measures;
    resolve(data);
  })
});

// let's start a second queue to reformat the measures
var sanitizeMeasuresOptions = {
  'specId': 'sanitize_withings_measures'
};
var sanitizeMeasuresQueue = new Queue(queueRef, sanitizeMeasuresOptions, function(data, progress, resolve, reject) {
  function pad(n, width, z) {
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
  }
  var measuregrps = data.measures.body.measuregrps
  measuregrps.every(function(measuregrp,grpindex,measuregrps){
    //console.log("handeling measure group number "+grpindex);
    var out = {
      ignore:false,
      epoch:measuregrp.date,
      withings_id:measuregrp.grpid
    }
    var withingsid=out.withings_id;
    var dateVal ="/Date("+out.epoch+"000)/";
    var dateTemp = new Date( parseFloat( dateVal.substr(6 )));
    var date = dateTemp.getFullYear()+"-"+pad((dateTemp.getMonth() + 1),2)+"-"+pad(dateTemp.getDate(),2)+" "+pad(dateTemp.getHours(),2) + ":" +pad(dateTemp.getMinutes(),2) + ":" + pad(dateTemp.getSeconds(),2)
    if (measuregrp.comment) {
        out.withings_comment=measuregrp.comment
    }
    measuregrp.measures.every(function(measure,index,measures){
      if (measure.type==11 || measure.type==54 || measure.type==4 || measure.type==9 || measure.type==10 || measure.type==11 || measure.type==71) {
        out.ignore=true;
        return false
      }
      measure.realvalue = measure.value*Math.pow(10,measure.unit);
      if (measure.type==1) {out.weight=measure.realvalue;}
      if (measure.type==5) {out.fatfreemass=measure.realvalue;}
      if (measure.type==6) {out.fatratio=measure.realvalue;}
      if (measure.type==8) {out.fatmass=measure.realvalue;}
      if (measure.type==76) {out.musclemass=measure.realvalue; out.muscleratio=Math.round(out.musclemass/out.weight*10000)/100}
      if (measure.type==77) {out.watermass=measure.realvalue; out.waterratio=Math.round(out.watermass/out.weight/10000)*100}
      if (measure.type==88) {out.bonemass=measure.realvalue; out.boneratio=Math.round(out.bonemass/out.weight*10000)/100}
      return true;
    })

    if (out.ignore==false) {
      if (data.measures_cleaned==null) {
        data.measures_cleaned=[];
      }
      delete out.ignore
      data.measures_cleaned.push({
        provider:"withings",
        provider_id:withingsid,
        provider_data:out,
        date:date
      })
    }
    return true;
  })
  resolve(data);
});

// now we have the measures_cleaned array on the task, let's fanout the measures to the user
var fanoutMeasuresOptions = {
  'specId': 'fanout_withings_measures'
};
var fanoutMeasuresQueue = new Queue(queueRef, fanoutMeasuresOptions, function(data, progress, resolve, reject) {

  //fetch the user's measures
  var usermeasures = firebase.database().ref('measures/'+data.user+"/").once('value').then(function(usermeasuresSnapshot){
    if (usermeasuresSnapshot.val()==null) {
      //there is no measures node for this user, let's create all measures in bulk :
      console.log("there is no measures node for this user, let's create all measures in bulk :")
      data.measures_cleaned.every(function(measure,index,measures){
        var newRef=firebase.database().ref('measures/'+data.user).push();
        newRef.update(measure)
        return true
      })
    } else {
      //now whe have both the user's measures and the measures to be updated
      data.measures_cleaned.every(function(measure,index,measures){
        var found=false;
        usermeasuresSnapshot.forEach(function(usermeasure){
          var usermeasureval=usermeasure.val()
          if(usermeasureval.provider==measure.provider && usermeasureval.provider_id==measure.provider_id) {
            // we have found the measure, let's update it
            firebase.database().ref('measures/'+data.user+"/"+usermeasure.key).update(measure);
            found=true;
          }
        })
        if (found==false) {
          var newRef=firebase.database().ref('measures/'+data.user+"/").push();
          newRef.set(measure)
        }
        return true
      })
    }
    resolve(data);
  })
});


function _formatIgnores (measure,prop) {
  var property="ignore_"+prop
  if ( ! measure.hasOwnProperty(property)) {
    if( measure.provider_data.hasOwnProperty(prop+"mass") || measure.provider_data.hasOwnProperty(prop+"ratio")) {
      measure[property]=false
    }
  }
  return measure;
}

function formatIgnores (measure) {

  if ( ! measure.hasOwnProperty("ingore_weight") && measure.provider_data.hasOwnProperty("weight")) {
    measure.ignore_weight=false
  }

  var properties=["fat","water","muscle","bone"];
  properties.forEach(function(prop){
    measure = _formatIgnores(measure,prop)
  })
  return measure
}

function _formatMeasure (measure,prop) {
  var ignored="ignore_"+prop
  if ( measure[ignored]==true )  { // prop should be ignored
    if (measure.provider_data.hasOwnProperty(prop+"mass")) {
      measure["ignored_"+prop+"mass"]=measure.provider_data[prop+"mass"]
    }
    if (measure.hasOwnProperty(prop+"mass")) {
      measure[prop+"mass"]=null //delete the propMass if it exists
    }
    if (measure.provider_data.hasOwnProperty(prop+"ratio")) {
      measure["ignored_"+prop+"ratio"]=measure.provider_data[prop+"ratio"]
    }
    if (measure.hasOwnProperty(prop+"ratio")) {
      measure[prop+"ratio"]=null //delete the propRatio if it exists
    }
  } else { // prop should be un-ignored
    if (measure.provider_data.hasOwnProperty(prop+"mass")) {
      measure[prop+"mass"]=measure.provider_data[prop+"mass"]
    }
    if (measure.hasOwnProperty("ignored_"+prop+"mass")) {
      measure["ignored_"+prop+"mass"]=null //delete the ignored_propMass if it exists
    }
    if (measure.provider_data.hasOwnProperty(prop+"ratio")) {
      measure[prop+"ratio"]=measure.provider_data[prop+"ratio"]
    }
    if (measure.hasOwnProperty("ignored_"+prop+"ratio")) {
      measure["ignored_"+prop+"ratio"]=null //delete the ignored_propRatio if it exists
    }
  }
  return measure
}

function _formatMeasureTime(measure) {
  if (measure.provider_data && measure.provider_data.epoch) {
    measure.sortup=measure.provider_data.epoch*1000
    measure.sortdown=9999999999999-measure.sortup
  }
  return measure
}

function formatMeasure (measure) {
  if (measure.ignore_weight) { // weight should be ignored
    measure.ignored_weight=measure.provider_data.weight;
    if (measure.hasOwnProperty("weight")) {
      measure.weight=null
    }
  } else { // weight should be un-ignored
    measure.weight=measure.provider_data.weight;
    if (measure.hasOwnProperty("ignoredweight")) {
      measure.weight=null
    }
  }

  var properties=["fat","water","muscle","bone"];
  properties.forEach(function(prop){
    measure = _formatMeasure(measure,prop)
  })
  
  measure = _formatMeasureTime(measure)
  return measure;
}

// now we have the measures in the user's subtree, let's format them
var formatMeasuresOptions = {
  'specId': 'format_measures'
};
var formatMeasuresQueue = new Queue(queueRef, formatMeasuresOptions, function(data, progress, resolve, reject) {

  //fetch the user's measures
  var usermeasures = firebase.database().ref('measures/'+data.user+"/").once('value').then(function(usermeasuresSnapshot){
    if (usermeasuresSnapshot.val()==null) {
      //there is no measures node for this user, this is a problem here !
    } else {
      // for every measure, populate the value from the provider data taking ignore settings into account
      usermeasuresSnapshot.forEach(function(usermeasure){

        var out = usermeasure.val()
        //console.log("Formating measure: "+JSON.stringify(out))
        out = formatIgnores(out);
        //console.log("formating continues with this: "+JSON.stringify(out))
        out = formatMeasure(out)
        //console.log("About to update the formatted measure: "+JSON.stringify(out))
        usermeasure.ref.update(out)
      })
      resolve(data);
    }
  })
});

// let's start our queue to get the notifications
var optionsGetNotifications = {
  'specId': 'get_notifications',
};
var queueRef = firebase.database().ref('queue');
var getNotificationsQueue = new Queue(queueRef, optionsGetNotifications, function(data, progress, resolve, reject) {

  var withings = require("withings-oauth2/dist/Withings").Withings
  var options = {
        consumerKey: config.withings_apikey,
        consumerSecret: config.withings_apisecret,
        accessToken: data.withings_oauth.token,
        accessTokenSecret: data.withings_oauth.token_secret,
        userID: data.withings_oauth.user_id
    };
  var client = new withings(options)

  client.listNotificationsAsync(1).then(function(notifs){
    data.withings_notifications=notifs;
    data.withings_notifications_length=notifs.length
    resolve(data);
  })
});

// let's start a second queue to revoke our notifications if there are
var revokeNotificationsOptions = {
  'specId': 'revoke_withings_notifications'
};
var revokeNotificationsQueue = new Queue(queueRef, revokeNotificationsOptions, function(data, progress, resolve, reject) {
  if (data.withings_notifications_length == 0) {
    // no notifications to revoke, continuing
    resolve(data);
  } else {
    //@TODO implement notification revocation when there is more than one in the list (need to sync all callbacks from withings)
    data.withings_notifications.forEach(function(notif){
      var withings = require("withings-oauth2/dist/Withings").Withings
      var options = {
            consumerKey: config.withings_apikey,
            consumerSecret: config.withings_apisecret,
            accessToken: data.withings_oauth.token,
            accessTokenSecret: data.withings_oauth.token_secret,
            userID: data.withings_oauth.user_id
        };
      var client = new withings(options)

      client.revokeNotificationAsync(notif.callbackurl, notif.appli).then(function(status){
        if (status.status==0) {
          console.log("notification revoked sucessfully.")
          resolve(data);
        } else {
          reject("Revocation of the notification failed with :"+JSON.stringify(status));
        }
      })
      resolve(data);
    })
  }
});

// and finally create a withings notification
var createNotificationOptions = {
  'specId': 'create_withings_notification'
};
var createNotificationQueue = new Queue(queueRef, createNotificationOptions, function(data, progress, resolve, reject) {

  var withings = require("withings-oauth2/dist/Withings").Withings
  var options = {
        consumerKey: config.withings_apikey,
        consumerSecret: config.withings_apisecret,
        accessToken: data.withings_oauth.token,
        accessTokenSecret: data.withings_oauth.token_secret,
        userID: data.withings_oauth.user_id
    };
  var client = new withings(options)

  data.debug={
      "config_withings_notification_callback": config.withings_notification_callback,
      "config_withings_notification_comment": config.withings_notification_comment
  }
  client.createNotificationAsync(config.withings_notification_callback, config.withings_notification_comment, 1).then(function(notifs){
    if (notifs.status==0) {
      console.log("notification created sucessfully : "+JSON.stringify(notifs))
      resolve(data);
    } else {
      //reject("Creation of the notification failed with :"+JSON.stringify(notifs));
        data.debug.failed=notifs
      resolve(data)
    }
  })
});

// let's start our queue to populate the notification
var optionsPopulateNotification = {
  'specId': 'populate_notification',
};
var PopulateNotificationQueue = new Queue(queueRef, optionsPopulateNotification, function(data, progress, resolve, reject) {

  // listen only to weight notifications :
  if (data.notification_body.appli!=1) {
    reject("Rejectig notification for non-weight. Type (appli) is :"+data.notification_body.appli)
  } else {
    // need to fin the user and add it's id and oauth credentials in the task.
    var usersRef = firebase.database().ref('users/').once('value').then(function(usersSnapshot){
      //now whe have all users
      var found=false
      usersSnapshot.forEach(function(user,index,users){
        var userval=user.val()
        if(userval.withings_oauth.user_id==data.notification_body.userid) {
          console.log("we have found the user, let's the task with it's info: "+userval.withings_oauth.user_id+" - "+user.key+" - "+(found?"true":"false"))
          if (found==false) {
            // we have found the user, let's the task with it's info
            data.withings_oauth=userval.withings_oauth
            data.user=user.key
            found=true;
          }
        }
      })
      if (found==false) {
        reject("Unable to find matching used for withings_user_id:"+data.notification_body.userid)
      } else {
        resolve(data);
      }
    })
  }
});

// [END app]
