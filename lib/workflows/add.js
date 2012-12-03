/*
 * Copyright (c) 2012, Joyent, Inc. All rights reserved.
 *
 * FWAPI: add rule workflow
 */

// These must match the names available in the workflow VM:
var async = require('async');
var common = require('./common');
var sdcClients = require('sdc-clients');
var verror = require('verror');



// --- Globals



// Make jslint happy:
var cnapiUrl;
var ufdsDn;
var ufdsPassword;
var ufdsUrl;



var VERSION = '0.0.1';



// --- Workflow functions



/**
 * Validate all parameters necessary for the workflow
 */
function validateParams(job, callback) {
  var globalsReq = {
    'CNAPI URL': cnapiUrl,
    'UFDS URL': ufdsUrl,
    'UFDS DN': ufdsDn,
    'UFDS password': ufdsPassword,
  };

  var jobParamsReq = {
    'dn': 'UFDS DN',
    'rule': 'rule',
    'ufdsRaw': 'UFDS raw data'
  };

  for (var p in globalsReq) {
    if (!globalsReq[p]) {
      return callback('No ' + globalsReq[p] + ' workflow parameter provided');
    }
  }

  for (var p in jobParamsReq) {
    if (!job.params[p]) {
      return callback('No ' + jobParamsReq[p] + ' parameter provided');
    }
  }

  return callback(null, 'parameters validated successfully');
}


/**
 * Add the rule to UFDS
 */
function addToUFDS(job, callback) {
  var ufdsOptions = {
      url: ufdsUrl,
      bindDN: ufdsDn,
      bindPassword: ufdsPassword
  };

  job.log.info(ufdsOptions, 'Creating UFDS client');
  var ufds = new sdcClients.UFDS(ufdsOptions);
  ufds.on('error', function (err) {
      return callback(err);
  });

  ufds.on('ready', function () {
    return ufds.add(job.params.dn, job.params.ufdsRaw, function (err) {
      if (err) {
        return callback(err);
      }
      return callback(null, 'Added rule to UFDS');
    });
  });
}


/**
 * Start a provisioner task with CNAPI on each of the servers to add
 * the rules
 */
function cnapiAddRules(job, callback) {
  var cnapi = new sdcClients.CNAPI({ url: cnapiUrl });
  job.params.firewall = {
    jobid: job.uuid,
    machines: job.params.ipData.machines,
    rules: [ job.params.rule ],
    tags: job.params.ipData.tags
  };
  job.params.taskIDs = [];

  async.forEach(job.params.servers, function (uuid, cb) {
    var endpoint = '/servers/' + uuid + '/fw/add';

    job.log.debug('Adding rules to server "%s"', uuid);
    return cnapi.post(endpoint, job.params.firewall,
      function (err, task) {
      if (err) {
        return cb(err);
      }
      job.log.debug(task, 'Server "%s": task', uuid);

      job.params.taskIDs.push({ server_uuid: uuid, task_id: task.id});
      return cb(null);
    });
  }, function (err) {
    if (err) {
      return callback(err);
    }

    return callback(null, 'Added rules to servers');
  });
}



// --- Exports



var workflow = module.exports = {
    name: 'add-' + VERSION,
    version: VERSION,
    chain: [ {
        name: 'validate_params',
        timeout: 10,
        retry: 1,
        body: validateParams
    }, {
        name: 'vmapi.get_vms',
        timeout: 10,
        retry: 1,
        body: common.getVMs
    }, {
        name: 'ufds.add_rule',
        timeout: 10,
        retry: 1,
        body: addToUFDS
    }, {
        name: 'cnapi.add_rule',
        timeout: 10,
        retry: 1,
        body: cnapiAddRules
    }, {
        name: 'cnapi.poll_tasks',
        timeout: 120,
        retry: 1,
        body: common.cnapiPollTasks
    } ],
    timeout: 210,
    onerror: [ {
        name: 'On error',
        body: function (job, cb) {
          // XXX: remove from UFDS if necessary
            return cb('Error executing job');
        }
    }]
};