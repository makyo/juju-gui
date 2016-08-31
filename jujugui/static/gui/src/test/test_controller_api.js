/*
This file is part of the Juju GUI, which lets users view and manage Juju
environments within a graphical interface (https://github.com/juju/juju-gui).
Copyright (C) 2016 Canonical Ltd.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License version 3, as published by
the Free Software Foundation.

This program is distributed in the hope that it will be useful, but WITHOUT
ANY WARRANTY; without even the implied warranties of MERCHANTABILITY,
SATISFACTORY QUALITY, or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Affero
General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

describe('Controller API', function() {
  var cleanups, conn, controllerAPI, juju, utils, Y;

  before(function(done) {
    Y = YUI(GlobalConfig).use([
      'juju-controller-api',
      'juju-tests-utils'
    ], function(Y) {
      juju = Y.namespace('juju');
      utils = Y.namespace('juju-tests.utils');
      done();
    });
  });

  beforeEach(function() {
    conn = new utils.SocketStub();
    controllerAPI = new juju.ControllerAPI({
      conn: conn, user: 'user', password: 'password'
    });
    controllerAPI.connect();
    controllerAPI.set('facades', {
      AllModelWatcher: [2],
      Cloud: [1],
      Controller: [3],
      MigrationTarget: [1],
      ModelManager: [2],
      Pinger: [1],
      UserManager: [1]
    });
    this._cleanups.push(controllerAPI.close.bind(controllerAPI));
    cleanups = [];
  });

  afterEach(function()  {
    cleanups.forEach(function(action) {action();});
    // We need to clear any credentials stored in sessionStorage.
    controllerAPI.setCredentials(null);
    if (controllerAPI && controllerAPI.destroy) {controllerAPI.destroy();}
    if (conn && conn.destroy) {conn.destroy();}
  });

  var noopHandleLogin = function() {
    var oldHandleLogin = Y.juju.ControllerAPI.handleLogin;
    Y.juju.ControllerAPI.handleLogin = function() {};
    cleanups.push(function() {
      Y.juju.ControllerAPI.handleLogin = oldHandleLogin;
    });
  };

  describe('findFacadeVersion', function() {

    beforeEach(function() {
      controllerAPI.set('facades', {'Test': [0, 1]});
    });

    afterEach(function() {});

    it('returns the version if the version is supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 0), 0);
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 1), 1);
    });

    it('returns the last version if the facade is supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test'), 1);
    });

    it('returns null if a specific version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('Test', 2), null);
    });

    it('returns null if a default version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('ChangeSet', 1), null);
    });

    it('returns null if a facade is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('BadWolf'), null);
    });

    it('returns null if a facade version is not supported', function() {
      assert.strictEqual(controllerAPI.findFacadeVersion('BadWolf', 42), null);
    });

  });

  describe('login', function() {
    it('sends the correct login message', function() {
      noopHandleLogin();
      controllerAPI.login();
      var lastMessage = conn.last_message();
      var expected = {
        type: 'Admin',
        request: 'Login',
        'request-id': 1,
        params: {'auth-tag': 'user-user', credentials: 'password'},
        version: 3
      };
      assert.deepEqual(expected, lastMessage);
    });

    it('resets the user and password if they are not valid', function() {
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, error: 'Invalid user or password'});
      assert.deepEqual(
        controllerAPI.getCredentials(),
        {user: '', password: '', macaroons: null});
      assert.isTrue(controllerAPI.failedAuthentication);
    });

    it('fires a login event on successful login', function() {
      var loginFired = false;
      var result;
      controllerAPI.on('login', function(evt) {
        loginFired = true;
        result = evt.data.result;
      });
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({
        'request-id': 1,
        response: {
          'user-info': {},
          facades: [{name: 'ModelManager', versions: [2]}]
        }
      });
      assert.isTrue(loginFired);
      assert.isTrue(result);
    });

    it('resets failed markers on successful login', function() {
      controllerAPI.failedAuthentication = true;
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({
        'request-id': 1,
        response: {
          'user-info': {},
          facades: [{name: 'ModelManager', versions: [2]}]
        }
      });
      assert.isFalse(controllerAPI.failedAuthentication);
    });

    it('fires a login event on failed login', function() {
      var loginFired = false;
      var result;
      controllerAPI.on('login', function(evt) {
        loginFired = true;
        result = evt.data.result;
      });
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, error: 'Invalid user or password'});
      assert.isTrue(loginFired);
      assert.isFalse(result);
    });

    it('avoids sending login requests without credentials', function() {
      controllerAPI.setCredentials(null);
      controllerAPI.login();
      assert.equal(0, conn.messages.length);
    });

    it('stores user information', function() {
      controllerAPI.login();
      // Assume login to be the first request.
      conn.msg({'request-id': 1, response: {
        facades: [
          {name: 'Client', versions: [0]},
          {name: 'ModelManager', versions: [2]}
        ],
        'user-info': {'read-only': true}
      }});
      assert.strictEqual(controllerAPI.get('readOnly'), true);
    });
  });

  describe('login with macaroons', function() {
    var error;

    // Create a callback to use when handling responses.
    var callback = function(err) {
      error = err;
    };

    // Create a fake bakery object with the given discharge fuction.
    var makeBakery = function(dischargeFunc) {
      return {discharge: dischargeFunc};
    };

    // Check that the given message sent to the WebSocket is what we expect.
    // Return the request id.
    var assertRequest = function(msg, macaroons) {
      assert.strictEqual(msg.type, 'Admin');
      assert.strictEqual(msg.request, 'Login');
      assert.strictEqual(msg.version, 3);
      if (macaroons) {
        assert.deepEqual(msg.params, {macaroons: [macaroons]});
      } else {
        assert.deepEqual(msg.params, {});
      }
      return msg['request-id'];
    };

    beforeEach(function() {
      error = '';
    });

    it('does not proceed if a login is pending', function() {
      controllerAPI.pendingLoginResponse = true;
      controllerAPI.loginWithMacaroon();
      assert.strictEqual(conn.messages.length, 0, 'unexpected messages');
    });

    it('sends an initial login request without macaroons', function() {
      controllerAPI.loginWithMacaroon(makeBakery());
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assertRequest(conn.last_message());
    });

    it('sends an initial login request with macaroons', function() {
      controllerAPI.setCredentials({macaroons: ['macaroon']});
      controllerAPI.loginWithMacaroon(makeBakery());
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assertRequest(conn.last_message(), ['macaroon']);
    });

    it('handles initial response errors', function() {
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({'request-id': requestId, error: 'bad wolf'});
      assert.strictEqual(error, 'authentication failed: bad wolf');
    });

    it('sends a second message after discharge', function() {
      var bakery = makeBakery(function(macaroon, success, fail) {
        assert.strictEqual(macaroon, 'discharge-required-macaroon');
        success(['macaroon', 'discharge']);
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 2, 'unexpected msg number');
      assertRequest(conn.last_message(), ['macaroon', 'discharge']);
    });

    it('handles discharge failures', function() {
      var bakery = makeBakery(function(macaroon, success, fail) {
        fail('bad wolf');
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      assert.strictEqual(error, 'macaroon discharge failed: bad wolf');
    });

    it('fails if user info is not provided in response', function() {
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({'request-id': requestId, response: {}});
      assert.strictEqual(
        error, 'authentication failed: use a proper Juju 2 release');
    });

    it('succeeds after discharge', function() {
      var bakery = makeBakery(function(macaroon, success, fail) {
        assert.strictEqual(macaroon, 'discharge-required-macaroon');
        success(['macaroon', 'discharge']);
      });
      controllerAPI.loginWithMacaroon(bakery, callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(conn.last_message());
      conn.msg({
        'request-id': requestId,
        response: {'discharge-required': 'discharge-required-macaroon'}
      });
      assert.strictEqual(conn.messages.length, 2, 'unexpected msg number');
      requestId = assertRequest(
        conn.last_message(), ['macaroon', 'discharge']);
      conn.msg({
        'request-id': requestId,
        response: {
          'user-info': {identity: 'who'},
          facades: [
            {name: 'Client', versions: [42, 47]},
            {name: 'ModelManager', versions: [2]}
          ]
        }
      });
      assert.strictEqual(error, null);
      var creds = controllerAPI.getCredentials();
      assert.strictEqual(creds.user, 'user-who');
      assert.strictEqual(creds.password, '');
      assert.deepEqual(creds.macaroons, ['macaroon', 'discharge']);
      assert.deepEqual(controllerAPI.get('facades'), {
        Client: [42, 47],
        ModelManager: [2]
      });
    });

    it('succeeds with already stored macaroons', function() {
      controllerAPI.setCredentials(
        {macaroons: ['already stored', 'macaroons']});
      controllerAPI.loginWithMacaroon(makeBakery(), callback);
      assert.strictEqual(conn.messages.length, 1, 'unexpected msg number');
      var requestId = assertRequest(
        conn.last_message(), ['already stored', 'macaroons']);
      conn.msg({
        'request-id': requestId,
        response: {
          'user-info': {identity: 'dalek'},
          facades: [
            {name: 'Client', versions: [0]},
            {name: 'ModelManager', versions: [2]}
          ]
        }
      });
      assert.strictEqual(error, null);
      var creds = controllerAPI.getCredentials();
      assert.strictEqual(creds.user, 'user-dalek');
      assert.strictEqual(creds.password, '');
      assert.deepEqual(creds.macaroons, ['already stored', 'macaroons']);
      assert.deepEqual(controllerAPI.get('facades'), {
        Client: [0],
        ModelManager: [2]
      });
    });

  });

  describe('websocket connection', function() {
    it('ignores rpc requests when websocket is not connected', function() {
      // Set the readyState to 2 for CLOSING.
      conn.readyState = 2;
      controllerAPI._send_rpc({
        type: 'ModelManager',
        request: 'ModelInfo',
        version: 1,
        'request-id': 1,
        params: {}
      });
      // No calls should be made.
      assert.equal(conn.messages.length, 0);
    });

    it('pings the server correctly', function() {
      controllerAPI.ping();
      var expectedMessage = {
        type: 'Pinger',
        request: 'Ping',
        version: 1,
        'request-id': 1,
        params: {}
      };
      assert.deepEqual(conn.last_message(), expectedMessage);
    });

    it('provides for a missing Params', function() {
      // If no "Params" are provided in an RPC call an empty one is added.
      var op = {type: 'ModelManager'};
      controllerAPI._send_rpc(op);
      assert.deepEqual(op.params, {});
    });
  });

  describe('destroyModels', function() {
    it('destroys models', function(done) {
      // Perform the request.
      controllerAPI.destroyModels(['model-tag-1'], function(response) {
        assert.strictEqual(response.err, undefined);
        assert.deepEqual(response.results, {
          'model-tag-1': null
        });
        assert.strictEqual(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'DestroyModels',
          params: {entities: [
            {tag: 'model-tag-1'}
          ]},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}]}
      });
    });

    it('destroys multiple models', function(done) {
      // Perform the request.
      controllerAPI.destroyModels(
        ['model-tag-1', 'model-tag-2'], function(response) {
          assert.strictEqual(response.err, undefined);
          assert.deepEqual(response.results, {
            'model-tag-1': null,
            'model-tag-2': null
          });
          assert.strictEqual(conn.messages.length, 1);
          assert.deepEqual(conn.last_message(), {
            type: 'ModelManager',
            version: 2,
            request: 'DestroyModels',
            params: {entities: [
              {tag: 'model-tag-1'},
              {tag: 'model-tag-2'}
            ]},
            'request-id': 1
          });
          done();
        });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [{}, {}]}
      });
    });

    it('handles local failures while destroying models', function(done) {
      // Perform the request.
      var tags = ['model-tag-1', 'model-tag-2', 'model-tag-3'];
      controllerAPI.destroyModels(tags, function(response) {
        assert.strictEqual(response.err, undefined);
        assert.deepEqual(response.results, {
          'model-tag-1': 'bad wolf',
          'model-tag-2': null,
          'model-tag-3': 'end of the universe'
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {results: [
          {error: {message: 'bad wolf'}},
          {},
          {error: {message: 'end of the universe'}}
        ]}
      });
    });

    it('handles global failures while destroying models', function(done) {
      // Perform the request.
      controllerAPI.destroyModels(['model-tag-1'], function(response) {
        assert.strictEqual(response.err, 'bad wolf');
        assert.strictEqual(response.results, undefined);
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });

    it('retrieves model info for a single model', function(done) {
      // Perform the request.
      var tag = 'model-5bea955d-7a43-47d3-89dd-b02c923e';
      controllerAPI.modelInfo([tag], function(data) {
        assert.strictEqual(data.err, undefined);
        assert.strictEqual(data.models.length, 1);
        var result = data.models[0];
        assert.strictEqual(result.tag, tag);
        assert.strictEqual(result.name, 'admin');
        assert.strictEqual(result.series, 'trusty');
        assert.strictEqual(result.provider, 'lxd');
        assert.strictEqual(result.uuid, '5bea955d-7a43-47d3-89dd-b02c923e');
        assert.strictEqual(result.serverUuid, '5bea955d-7a43-47d3-89dd');
        assert.strictEqual(result.life, 'alive');
        assert.strictEqual(result.ownerTag, 'user-admin@local');
        assert.strictEqual(result.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result.isAdmin, false, 'unexpected admin model');
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [{tag: tag}]},
          'request-id': 1
        });
        done();
      });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-7a43-47d3-89dd-b02c923e',
              'controller-uuid': '5bea955d-7a43-47d3-89dd',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }]
        }
      });
    });
  });

  describe('modelInfo', function() {
    it('retrieves model info for multiple models', function(done) {
      // Perform the request.
      var tag1 = 'model-5bea955d-7a43-47d3-89dd-tag1';
      var tag2 = 'model-5bea955d-7a43-47d3-89dd-tag2';
      controllerAPI.modelInfo([tag1, tag2], function(data) {
        assert.strictEqual(data.err, undefined);
        assert.strictEqual(data.models.length, 2);
        var result1 = data.models[0];
        assert.strictEqual(result1.tag, tag1);
        assert.strictEqual(result1.name, 'model1');
        assert.strictEqual(result1.series, 'trusty');
        assert.strictEqual(result1.provider, 'lxd');
        assert.strictEqual(result1.uuid, '5bea955d-7a43-47d3-89dd-tag1');
        assert.strictEqual(
          result1.serverUuid, '5bea955d-7a43-47d3-89dd-tag1');
        assert.strictEqual(result1.life, 'alive');
        assert.strictEqual(result1.ownerTag, 'user-admin@local');
        assert.strictEqual(result1.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result1.isAdmin, true, 'unexpected regular model');
        var result2 = data.models[1];
        assert.strictEqual(result2.tag, tag2);
        assert.strictEqual(result2.name, 'model2');
        assert.strictEqual(result2.series, 'xenial');
        assert.strictEqual(result2.provider, 'aws');
        assert.strictEqual(result2.uuid, '5bea955d-7a43-47d3-89dd-tag2');
        assert.strictEqual(
          result2.serverUuid, '5bea955d-7a43-47d3-89dd-tag1');
        assert.strictEqual(result2.life, 'dying');
        assert.strictEqual(result2.ownerTag, 'user-dalek@skaro');
        assert.strictEqual(result2.isAlive, false, 'unexpected alive model');
        assert.strictEqual(result2.isAdmin, false, 'unexpected admin model');
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [{tag: tag1}, {tag: tag2}]},
          'request-id': 1
        });
        done();
      });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'model1',
              'provider-type': 'lxd',
              uuid: '5bea955d-7a43-47d3-89dd-tag1',
              'controller-uuid': '5bea955d-7a43-47d3-89dd-tag1',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }, {
            result: {
              'default-series': 'xenial',
              name: 'model2',
              'provider-type': 'aws',
              uuid: '5bea955d-7a43-47d3-89dd-tag2',
              'controller-uuid': '5bea955d-7a43-47d3-89dd-tag1',
              life: 'dying',
              'owner-tag': 'user-dalek@skaro'
            }
          }]
        }
      });
    });

    it('handles request failures while fetching model info', function(done) {
      // Perform the request.
      controllerAPI.modelInfo(
        ['model-5bea955d-7a43-47d3-89dd'], function(data) {
          assert.strictEqual(data.err, 'bad wolf');
          done();
        });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        error: {message: 'bad wolf'}
      });
    });

    it('handles API failures while retrieving model info', function(done) {
      // Perform the request.
      var tag = 'model-5bea955d-7a43-47d3-89dd';
      controllerAPI.modelInfo([tag], function(data) {
        assert.strictEqual(data.err, undefined);
        assert.strictEqual(data.models.length, 1);
        var result = data.models[0];
        assert.strictEqual(result.tag, tag);
        assert.strictEqual(result.err, 'bad wolf');
        done();
      });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          results: [{
            error: {message: 'bad wolf'}
          }]
        }
      });
    });

    it('handles unexpected failures while getting model info',
      function(done) {
        // Perform the request.
        controllerAPI.modelInfo(
          ['model-5bea955d-7a43-47d3-89dd'], function(data) {
            assert.strictEqual(data.err, 'unexpected results: []');
            done();
          });

        // Mimic response.
        conn.msg({
          'request-id': 1,
          response: {results: []}
        });
      });
  });

  describe('listModelsWithInfo', function() {
    it('listModelsWithInfo: info for a single model', function(done) {
      controllerAPI.setCredentials({user: 'user-who', password: 'tardis'});
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.strictEqual(err, null);
        assert.strictEqual(data.models.length, 1);
        var result = data.models[0];
        assert.strictEqual(result.err, undefined);
        assert.strictEqual(result.tag, 'model-5bea955d-1');
        assert.strictEqual(result.name, 'admin');
        assert.strictEqual(result.series, 'trusty');
        assert.strictEqual(result.provider, 'lxd');
        assert.strictEqual(result.uuid, '5bea955d-1');
        assert.strictEqual(result.serverUuid, '5bea955d-c');
        assert.strictEqual(result.life, 'alive');
        assert.strictEqual(result.ownerTag, 'user-admin@local');
        assert.strictEqual(result.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result.isAdmin, false, 'unexpected admin model');
        assert.strictEqual(result.lastConnection, 'today');
        assert.equal(conn.messages.length, 2);
        assert.deepEqual(conn.messages[0], {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-who'},
          'request-id': 1
        });
        assert.deepEqual(conn.messages[1], {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [{tag: 'model-5bea955d-1'}]},
          'request-id': 2
        });
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'admin',
              'owner-tag': 'user-who',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-1',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-admin@local'
            }
          }]
        }
      });
    });

    it('listModelsWithInfo: info for multiple models', function(done) {
      controllerAPI.setCredentials(
        {user: 'user-dalek', password: 'exterminate'});
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.strictEqual(err, null);
        assert.strictEqual(data.models.length, 3);
        var result1 = data.models[0];
        assert.strictEqual(result1.err, undefined);
        assert.strictEqual(result1.tag, 'model-5bea955d-1');
        assert.strictEqual(result1.name, 'default');
        assert.strictEqual(result1.series, 'xenial');
        assert.strictEqual(result1.provider, 'lxd');
        assert.strictEqual(result1.uuid, '5bea955d-1');
        assert.strictEqual(result1.serverUuid, '5bea955d-c');
        assert.strictEqual(result1.life, 'dead');
        assert.strictEqual(result1.ownerTag, 'user-dalek@local');
        assert.strictEqual(result1.isAlive, false, 'unexpected alive model');
        assert.strictEqual(result1.isAdmin, false, 'unexpected admin model');
        assert.strictEqual(result1.lastConnection, 'today');
        var result2 = data.models[1];
        assert.strictEqual(result2.err, undefined);
        assert.strictEqual(result2.tag, 'model-5bea955d-c');
        assert.strictEqual(result2.name, 'admin');
        assert.strictEqual(result2.series, 'trusty');
        assert.strictEqual(result2.provider, 'lxd');
        assert.strictEqual(result2.uuid, '5bea955d-c');
        assert.strictEqual(result2.serverUuid, '5bea955d-c');
        assert.strictEqual(result2.life, 'alive');
        assert.strictEqual(result2.ownerTag, 'user-who@local');
        assert.strictEqual(result2.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result2.isAdmin, true, 'unexpected regular model');
        assert.strictEqual(result2.lastConnection, 'yesterday');
        var result3 = data.models[2];
        assert.strictEqual(result3.err, undefined);
        assert.strictEqual(result3.tag, 'model-5bea955d-3');
        assert.strictEqual(result3.name, 'mymodel');
        assert.strictEqual(result3.series, 'precise');
        assert.strictEqual(result3.provider, 'aws');
        assert.strictEqual(result3.uuid, '5bea955d-3');
        assert.strictEqual(result3.serverUuid, '5bea955d-c');
        assert.strictEqual(result3.life, 'alive');
        assert.strictEqual(result3.ownerTag, 'user-cyberman@local');
        assert.strictEqual(result3.isAlive, true, 'unexpected zombie model');
        assert.strictEqual(result3.isAdmin, false, 'unexpected admin model');
        assert.strictEqual(result3.lastConnection, 'tomorrow');
        assert.equal(conn.messages.length, 2);
        assert.deepEqual(conn.messages[0], {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-dalek'},
          'request-id': 1
        });
        assert.deepEqual(conn.messages[1], {
          type: 'ModelManager',
          version: 2,
          request: 'ModelInfo',
          params: {entities: [
            {tag: 'model-5bea955d-1'},
            {tag: 'model-5bea955d-c'},
            {tag: 'model-5bea955d-3'}
          ]},
          'request-id': 2
        });
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }, {
            model: {
              name: 'admin',
              'owner-tag': 'user-who',
              uuid: '5bea955d-c'
            },
            'last-connection': 'yesterday'
          }, {
            model: {
              name: 'mymodel',
              'owner-tag': 'user-cyberman',
              uuid: '5bea955d-3'
            },
            'last-connection': 'tomorrow'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            result: {
              'default-series': 'xenial',
              name: 'default',
              'provider-type': 'lxd',
              uuid: '5bea955d-1',
              'controller-uuid': '5bea955d-c',
              life: 'dead',
              'owner-tag': 'user-dalek@local'
            }
          }, {
            result: {
              'default-series': 'trusty',
              name: 'admin',
              'provider-type': 'lxd',
              uuid: '5bea955d-c',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-who@local'
            }
          }, {
            result: {
              'default-series': 'precise',
              name: 'mymodel',
              'provider-type': 'aws',
              uuid: '5bea955d-3',
              'controller-uuid': '5bea955d-c',
              life: 'alive',
              'owner-tag': 'user-cyberman@local'
            }
          }]
        }
      });
    });

    it('listModelsWithInfo: credentials error', function(done) {
      controllerAPI.setCredentials(null);
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.equal(err, 'called without credentials');
        done();
      });
    });

    it('listModelsWithInfo: list models error', function(done) {
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.strictEqual(err, 'bad wolf');
        done();
      });

      // Mimic response.
      conn.msg({
        'request-id': 1,
        error: 'bad wolf'
      });
    });

    it('listModelsWithInfo: model info error', function(done) {
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.strictEqual(err, 'bad wolf');
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        error: {message: 'bad wolf'}
      });
    });

    it('listModelsWithInfo: specific model response error', function(done) {
      // Perform the request.
      controllerAPI.listModelsWithInfo(function(err, data) {
        assert.strictEqual(err, null);
        assert.strictEqual(data.models.length, 1);
        var result = data.models[0];
        assert.strictEqual(result.tag, 'model-5bea955d-1');
        assert.strictEqual(result.err, 'bad wolf');
        done();
      });

      // Mimic first response to ModelManager.ListModels.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'default',
              'owner-tag': 'user-dalek',
              uuid: '5bea955d-1'
            },
            'last-connection': 'today'
          }]
        }
      });
      // Mimic second response to ModelManager.ModelInfo.
      conn.msg({
        'request-id': 2,
        response: {
          results: [{
            error: {message: 'bad wolf'}
          }]
        }
      });
    });
  });

  describe('createModel', function() {
    it('successfully creates a model', function(done) {
      controllerAPI.createModel('mymodel', 'user-who@external', function(data) {
        assert.strictEqual(data.err, undefined);
        assert.strictEqual(data.name, 'mymodel');
        assert.strictEqual(data.uuid, 'unique-id');
        assert.strictEqual(data.owner, 'user-rose@external');
        assert.strictEqual(data.region, 'alpha-quadrant');
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'CreateModel',
          params: {
            name: 'mymodel',
            'owner-tag': 'user-who@external'
          },
          'request-id': 1
        });
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({
        'request-id': 1,
        response: {
          name: 'mymodel',
          uuid: 'unique-id',
          'owner-tag': 'user-rose@external',
          'cloud-region': 'alpha-quadrant'
        }
      });
    });

    it('adds local user domain when creating a model', function(done) {
      controllerAPI.createModel('mymodel', 'user-cyberman', function(data) {
        assert.strictEqual(data.err, undefined);
        assert.equal(conn.messages.length, 1);
        var message = conn.last_message();
        assert.strictEqual(
          message.params['owner-tag'], 'user-cyberman@local');
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({
        'request-id': 1,
        response: {
          name: 'mymodel',
          uuid: 'unique-id',
          'owner-tag': 'user-rose@local',
          'cloud-region': 'delta-quadrant'
        }
      });
    });

    it('handles failures while creating models', function(done) {
      controllerAPI.createModel('bad-model', 'user-dalek', function(data) {
        assert.strictEqual(data.err, 'bad wolf');
        done();
      });
      // Mimic the response to ModelManager.CreateModel.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });
  });

  describe('listModels', function() {
    it('lists models for a specific owner', function(done) {
      controllerAPI.listModels('user-who', function(data) {
        assert.strictEqual(data.err, undefined);
        assert.deepEqual([
          {
            name: 'env1',
            tag: 'model-unique1',
            owner: 'user-who',
            uuid: 'unique1',
            lastConnection: 'today'
          },
          {
            name: 'env2',
            tag: 'model-unique2',
            owner: 'user-rose',
            uuid: 'unique2',
            lastConnection: 'yesterday'
          }
        ], data.envs);
        assert.equal(conn.messages.length, 1);
        assert.deepEqual(conn.last_message(), {
          type: 'ModelManager',
          version: 2,
          request: 'ListModels',
          params: {tag: 'user-who'},
          'request-id': 1
        });
        done();
      });
      // Mimic response.
      conn.msg({
        'request-id': 1,
        response: {
          'user-models': [{
            model: {
              name: 'env1',
              'owner-tag': 'user-who',
              uuid: 'unique1'
            },
            'last-connection': 'today'
          }, {
            model: {
              name: 'env2',
              'owner-tag': 'user-rose',
              uuid: 'unique2'
            },
            'last-connection': 'yesterday'
          }]
        }
      });
    });

    it('handles failures while listing models', function(done) {
      controllerAPI.listModels('user-dalek', function(data) {
        assert.strictEqual(data.err, 'bad wolf');
        done();
      });
      // Mimic response.
      conn.msg({'request-id': 1, error: 'bad wolf'});
    });
  });

});