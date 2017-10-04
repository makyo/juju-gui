/* Copyright (C) 2015 Canonical Ltd. */

'use strict';

describe('jujulib charmstore', function() {
  let charmstore;

  beforeEach(function() {
    const bakery = {
      get: sinon.stub(),
      put: sinon.stub()
    };
    charmstore = new window.jujulib.charmstore('local/', bakery);
  });

  afterEach(function() {
    charmstore = null;
  });

  it('can be instantiated with the proper config values', function() {
    assert.strictEqual(charmstore.url, 'local/v5');
  });

  it('is smart enough to handle missing trailing slash in URL', function() {
    var bakery = {};
    charmstore = new window.jujulib.charmstore('http://example.com', bakery);
    assert.strictEqual(charmstore.url, 'http://example.com/v5');
  });

  describe('_generatePath', function() {

    it('generates a valid url using provided args', function() {
      var path = charmstore._generatePath('search/', 'text=foo');
      assert.equal(path, 'local/v5/search/?text=foo');
    });
  });

  describe('getLogoutUrl', function() {
    it('returns a valid logout url', function() {
      var path = charmstore.getLogoutUrl();
      assert.equal(path, 'local/v5/logout');
    });
  });

  describe('_transformQueryResults', function() {
    var data = {
      Results: [
        { entityType: 'charm', id: 'cs:precise/foo',
          Id: 'cs:precise/foo',
          Meta: { 'extra-info' : { 'bzr-owner': ''}}},
        { entityType: 'charm', id: 'cs:~charmers/precise/foo',
          Id: 'cs:~charmers/precise/foo',
          Meta: { 'extra-info' : { 'bzr-owner': 'charmers'}}},
        { entityType: 'charm', id: 'cs:~juju-gui-charmers/precise/foo',
          Id: 'cs:~juju-gui-charmers/precise/foo',
          Meta: { 'extra-info' : { 'bzr-owner': 'juju-gui-charmers'}}},
        { entityType: 'bundle', id: 'cs:bundle/foo',
          Id: 'cs:bundle/foo',
          Meta: { 'extra-info' : { 'bzr-owner': ''}}}
      ]};
    var cb;

    beforeEach(function() {
      cb = sinon.stub();
    });

    afterEach(function() {
      assert.equal(cb.callCount, 1);
    });

    it('calls to process query response data for each record', function() {
      var process = sinon.stub(charmstore, '_processEntityQueryData');
      charmstore._transformQueryResults(cb, null, data);
      assert.equal(process.callCount, 4);
    });

    it('can use a processing function to massage data', function() {
      charmstore._processEntityQueryData = function(entity) {
        return entity;
      };
      charmstore.processEntity = function (data) {
        if (data.entityType === 'charm') {
          return 'It\'s a charm.';
        } else {
          return 'It\'s a bundle.';
        }
      };
      charmstore._transformQueryResults(cb, null, data);
      var models = cb.lastCall.args[1];
      assert.equal(models[0], 'It\'s a charm.');
      assert.equal(models[1], 'It\'s a charm.');
      assert.equal(models[2], 'It\'s a charm.');
      assert.equal(models[3], 'It\'s a bundle.');
    });

    it('errors when no data is provided even if there is no error', function() {
      charmstore._transformQueryResults(cb, null, null);
      assert.equal(
        cb.args[0][0],
        'no entity data returned, can you access the charmstore?');
    });
  });

  describe('_lowerCaseKeys', function() {

    it('can recursively transform an objects keys to lowercase', function() {
      var uppercase = { Baz: '1', Foo: { Bar: { Baz: '1' }}};
      var host = {};
      charmstore._lowerCaseKeys(uppercase, host);
      assert.deepEqual(host, { baz: '1', foo: { bar: { baz: '1'}}});
    });

    it('can skip one level of keys in an object', function() {
      var uppercase = { Baz: '1', Foo: { Bar: { Baz: '1' }}, Fee: '2'};
      var host = {};
      charmstore._lowerCaseKeys(uppercase, host, 0);
      assert.deepEqual(host, { Baz: '1', Foo: { bar: { baz: '1'}}, Fee: '2'});
    });
  });

  describe('_processEntityQueryData', function() {

    it('can properly transform v5 charm data', function() {
      const data = {
        Id: 'cs:trusty/mongodb-9',
        Meta: {
          'charm-metadata': {
            Name: 'mongodb',
            Provides: {
              db: {
                'Name': 'db',
                'Role': 'requirer',
                'Interface': 'mongo',
                'Optional': false,
                'Limit': 1,
                'Scope': 'global'
              }
            }
          },
          'owner': {
            User: 'hatch'
          },
          'extra-info': {
            'bzr-url': 'cs:precise/mongodb'
          },
          'revision-info': {
            Revisions: ['rev1', 'rev2', 'rev4']
          },
          'charm-config': {
            Options: {
              'foo-optn': {
                Default: 'foo',
                Description: 'foo is awesome',
                Type: 'String'
              },
              'barOptn': {
                Default: 'bar',
                Description: 'bar is less awesome',
                Type: 'String'
              }
            }
          },
          'charm-metrics': {
            Metrics: {
              metric: 'metric'
            }
          },
          published: {Info: [
            {Channel: 'stable', Current: true},
            {Channel: 'edge', Current: false}
          ]},
          stats: {
            ArchiveDownloadCount: 10
          },
          'supported-series': {
            SupportedSeries: [
              'precise',
              'trusty'
            ]
          }
        }
      };
      const processed = charmstore._processEntityQueryData(data);
      assert.deepEqual(processed, {
        id: 'cs:trusty/mongodb-9',
        channels: [{
          name: 'stable', current: true
        }, {
          name: 'edge', current: false
        }],
        downloads: 10,
        entityType: 'charm',
        is_approved: true,
        is_subordinate: false,
        metrics: {
          metric: 'metric'
        },
        owner: 'hatch',
        revisions: ['rev1', 'rev2', 'rev4'],
        code_source: {
          location: 'cs:precise/mongodb'
        },
        name: 'mongodb',
        relations: {
          provides: {
            db: {
              'name': 'db',
              'role': 'requirer',
              'interface': 'mongo',
              'optional': false,
              'limit': 1,
              'scope': 'global'
            }
          },
          requires: {}
        },
        options: {
          'foo-optn': {
            'default': 'foo',
            description: 'foo is awesome',
            type: 'String'
          },
          'barOptn': {
            'default': 'bar',
            description: 'bar is less awesome',
            type: 'String'
          }
        },
        series: ['precise', 'trusty']
      });
    });

    it('handles missing extra-info data', function() {
      var data = {
        Id: 'cs:trusty/mongodb-9',
        Meta: {
          'charm-metadata': {
            Name: 'mongodb',
            Provides: {}
          },
          'extra-info': {},
          'charm-config': {Options: {}},
          stats: {ArchiveDownloadCount: 42}
        }
      };
      var processed = charmstore._processEntityQueryData(data);
      assert.strictEqual(processed.owner, undefined);
      assert.strictEqual(processed.code_source.location, undefined);
      assert.deepEqual(processed.revisions, []);
    });

    it('can properly transform v4 bundle data', function() {
      const data = {
        Id: 'cs:~charmers/bundle/mongodb-cluster-4',
        Meta: {
          'bundle-metadata': {
            'Services': ''
          },
          'bundle-unit-count': {
            'Count': 7
          },
          owner: {
            User: 'hatch'
          },
          'extra-info': {
            'bzr-url': 'lp:~charmers/charms/bundles/mongodb-cluster/bundle'
          },
          'revision-info': {
            Revisions: ['rev1', 'rev2']
          },
          stats: {
            ArchiveDownloadCount: 10
          }
        }
      };
      const processed = charmstore._processEntityQueryData(data);
      assert.deepEqual(processed, {
        code_source: {
          location: 'lp:~charmers/charms/bundles/mongodb-cluster/bundle'
        },
        channels: [],
        deployerFileUrl: 'local/v5/~charmers/bundle/mongodb-cluster-4/' +
            'archive/bundle.yaml',
        downloads: 10,
        entityType: 'bundle',
        id: 'cs:~charmers/bundle/mongodb-cluster-4',
        is_approved: false,
        name: 'mongodb-cluster',
        owner: 'hatch',
        revisions: ['rev1', 'rev2'],
        services: '',
        unitCount: 7
      });
    });
  });

  describe('search', function() {
    var generatePath;

    beforeEach(function() {
      generatePath = sinon.stub(charmstore, '_generatePath').returns('path');
    });

    it('accepts custom filters & calls to generate an api path', function() {
      charmstore.search({ text: 'foo' });
      assert.equal(generatePath.callCount, 1, 'generatePath not called');
      assert.deepEqual(generatePath.lastCall.args, [
        'search',
        'text=foo&' +
            'limit=30&' +
            'autocomplete=1&' +
            'include=charm-metadata&' +
            'include=supported-series&' +
            'include=bundle-metadata&' +
            'include=extra-info&' +
            'include=owner']);
    });

    it('accepts a custom limit when generating an api path', function() {
      charmstore.search({ text: 'foo' }, null, 99);
      assert.equal(generatePath.callCount, 1, 'generatePath not called');
      assert.deepEqual(generatePath.lastCall.args, [
        'search',
        'text=foo&' +
            'limit=99&' +
            'autocomplete=1&' +
            'include=charm-metadata&' +
            'include=supported-series&' +
            'include=bundle-metadata&' +
            'include=extra-info&' +
            'include=owner']);
    });

    it('calls to make a valid charmstore search request', function() {
      var transform = sinon.stub(charmstore, '_transformQueryResults');
      charmstore.search({}, 'cb');
      assert.equal(
        charmstore.bakery.get.callCount, 1,
        'sendGetRequest not called');
      var requestArgs = charmstore.bakery.get.lastCall.args;
      var successCb = requestArgs[2];
      assert.equal(requestArgs[0], 'path');
      // Call the success handler to make sure it's passed the callback.
      successCb({target: {responseText: '{}'}});
      assert.equal(transform.lastCall.args[0], 'cb');
    });
  });

  describe('list', function() {
    var generatePath;

    beforeEach(function() {
      generatePath = sinon.stub(charmstore, '_generatePath').returns('path');
    });

    it('accepts an author & calls to generate an api path', function() {
      charmstore.list('test-author', 'cb');
      assert.equal(generatePath.callCount, 1, 'generatePath not called');
      assert.deepEqual(generatePath.lastCall.args, [
        'list',
        'owner=test-author&' +
            'type=charm&' +
            'include=charm-metadata&' +
            'include=bundle-metadata&' +
            'include=bundle-unit-count&' +
            'include=extra-info&' +
            'include=supported-series&' +
            'include=stats&' +
            'include=perm']);
    });

    it('can list bundles', function() {
      charmstore.list('test-author', 'cb', 'bundle');
      var qs = generatePath.lastCall.args[1];
      assert.equal(qs.indexOf('type=bundle') > -1, true,
        'bundle not set in query string');
    });

    it('calls to make a valid charmstore list request', function() {
      var transform = sinon.stub(charmstore, '_transformQueryResults');
      charmstore.list('test-author', 'cb');
      assert.equal(
        charmstore.bakery.get.callCount, 1,
        'sendGetRequest not called');
      var requestArgs = charmstore.bakery.get.lastCall.args;
      var successCb = requestArgs[2];
      assert.equal(requestArgs[0], 'path');
      // Call the success handler to make sure it's passed the callback.
      successCb({target: {responseText: '{}'}});
      assert.equal(transform.lastCall.args[0], 'cb');
    });
  });

  describe('getDiagramURL', function() {
    it('can generate a URL for a bundle diagram', function() {
      assert.equal(charmstore.getDiagramURL('apache2'),
        'local/v5/apache2/diagram.svg');
    });
  });

  describe('getBundleYAML', function() {
    var cb;

    beforeEach(function() {
      cb = sinon.stub();
    });

    it('calls to get the bundle entity', function() {
      var getEntity = sinon.stub(charmstore, 'getEntity');
      var response = sinon.stub(charmstore, '_getBundleYAMLResponse');
      var bundleId = 'bundle/elasticsearch';
      charmstore.getBundleYAML(bundleId, cb);
      var getEntityArgs = getEntity.lastCall.args;
      assert.equal(getEntity.callCount, 1);
      assert.equal(getEntityArgs[0], bundleId);
      getEntityArgs[1](); // Should be a bound copy of _getBundleYAMLResponse.
      // We need to make sure it's bound with the callback.
      var responseArgs = response.lastCall.args;
      responseArgs[0](); // Should be the callback.
      assert.equal(cb.callCount, 1);
    });

    it('_getBundleYAMLResponse fetches yaml file contents', function() {
      charmstore._getBundleYAMLResponse(
        cb, null, [{ deployerFileUrl: 'deployer file' }]);
      var requestArgs = charmstore.bakery.get.lastCall.args;
      assert.equal(requestArgs[0], 'deployer file');
      // Should be the anon success callback handler.
      requestArgs[2](null, {
        target: {
          responseText: 'yaml'
        }
      });
      assert.equal(cb.callCount, 1);
      assert.equal(cb.lastCall.args[1], 'yaml');
    });
  });

  describe('getAvailableVersions', function() {
    it('makes a request to fetch the ids', function() {
      charmstore.getAvailableVersions('cs:precise/ghost-5');
      assert.equal(charmstore.bakery.get.callCount, 1);
    });

    it('calls the success handler with a list of charm ids', function(done) {
      var cb = function(error, list) {
        // If it gets here then it has successfully called.
        if (error) {
          assert.fail('callback should not fail.');
        }
        assert.deepEqual(list, ['cs:precise/ghost-4']);
        done();
      };
      charmstore.getAvailableVersions('cs:precise/ghost-5', cb);
      var requestArgs = charmstore.bakery.get.lastCall.args;
      // The path should not have cs: in it.
      assert.equal(requestArgs[0], 'local/v5/precise/ghost-5/expand-id');
      // Call the makeRequest success handler simulating a response object;
      requestArgs[2](null,
        {target: { responseText: '[{"Id": "cs:precise/ghost-4"}]'}});
    });

    it('calls the failure handler for json parse failures', function(done) {
      var cb = function(error, list) {
        if (error) {
          done();
        } else {
          assert.fail('callback should not succeed.');
        }
      };
      charmstore.getAvailableVersions('cs:precise/ghost-5', cb);
      // Call the makeRequest success handler simulating a response object;
      charmstore.bakery.get.lastCall.args[2](null,
        {target: { responseText: '[notvalidjson]'}});
    });
  });

  describe('whoami', function() {
    it('queries who the current user is', function() {
      charmstore.whoami();
      assert.equal(charmstore.bakery.get.callCount, 1);
    });

    it('calls the success handler with an auth object', function(done) {
      var cb = function(error, auth) {
        // If it gets here then it has successfully called.
        if (error) {
          assert.fail('callback should not fail.');
        }
        assert.deepEqual(auth, {user: 'test', groups: []});
        done();
      };
      charmstore.whoami(cb);
      var requestArgs = charmstore.bakery.get.lastCall.args;
      assert.equal(requestArgs[0], 'local/v5/whoami');
      // Call the makeRequest success handler simulating a response object;
      requestArgs[2](null,
        {target: { responseText: '{"User": "test", "Groups": []}'}});
    });

    it('calls the failure handler for json parse failures', function(done) {
      var cb = function(error, list) {
        if (error) {
          done();
        } else {
          assert.fail('callback should not succeed.');
        }
      };
      charmstore.whoami(cb);
      // Call the makeRequest success handler simulating a response object;
      charmstore.bakery.get.lastCall.args[2](
        {target: { responseText: '[notvalidjson]'}});
    });
  });

  describe('getCanonicalId', function() {
    it('makes a request to fetch the canonical id for an entity', function() {
      const callback = sinon.stub();
      charmstore.getCanonicalId('cs:xenial/ghost-4', callback);
      const bakeryGet = charmstore.bakery.get;
      assert.equal(bakeryGet.callCount, 1);
      const requestPath = bakeryGet.args[0][0];
      assert.equal(requestPath, 'local/v5/xenial/ghost-4/meta/id');
      // Call the success request callback
      bakeryGet.args[0][2](null, {
        target: {
          responseText: '{"Id": "cs:ghost"}'
        }
      });
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.args[0], [null, 'cs:ghost']);
    });

    it('properly calls the callback when there is an error', function() {
      const callback = sinon.stub();
      charmstore.getCanonicalId('cs:xenial/ghost-4', callback);
      const bakeryGet = charmstore.bakery.get;
      assert.equal(bakeryGet.callCount, 1);
      const requestPath = bakeryGet.args[0][0];
      assert.equal(requestPath, 'local/v5/xenial/ghost-4/meta/id');
      // Call the error request callback.
      bakeryGet.args[0][2]('not found');
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.args[0], ['not found', null]);
    });
  });

  describe('getEntity', function() {
    it('strips cs from bundle IDs', function() {
      charmstore.getEntity('cs:foobar', sinon.stub());
      var path = charmstore.bakery.get.lastCall.args[0];
      assert.equal(path.indexOf('cs:'), -1,
        'The string "cs:" should not be found in the path');
    });

    it('calls the correct path', function() {
      charmstore.getEntity('cs:foobar', sinon.stub());
      const path = charmstore.bakery.get.lastCall.args[0];
      const expectedPath = (
        'local/v5/foobar/meta/any' +
        '?include=bundle-metadata' +
        '&include=bundle-machine-count' +
        '&include=charm-config' +
        '&include=charm-metadata' +
        '&include=charm-metrics' +
        '&include=common-info' +
        '&include=extra-info' +
        '&include=id-revision' +
        '&include=manifest' +
        '&include=owner' +
        '&include=published' +
        '&include=resources' +
        '&include=revision-info' +
        '&include=stats' +
        '&include=supported-series' +
        '&include=tags'
      );
      assert.strictEqual(path, expectedPath);
    });
  });

  describe('getResources', function() {
    it('can get resources for a charm', function() {
      const callback = sinon.stub();
      charmstore.getResources('cs:xenial/ghost-4', callback);
      const bakeryGet = charmstore.bakery.get;
      assert.equal(bakeryGet.callCount, 1);
      const requestPath = bakeryGet.args[0][0];
      assert.equal(requestPath, 'local/v5/xenial/ghost-4/meta/resources');
      // Call the success request callback
      bakeryGet.args[0][2](null, {
        target: {
          responseText: '[' +
            '{"Name":"file1","Type":"file","Path":"file1.zip","Description":' +
            '"desc.","Revision":5,"Fingerprint":"123","Size":168},' +
            '{"Name":"file2","Type":"file","Path":"file2.zip","Description":' +
            '"desc.","Revision":5,"Fingerprint":"123","Size":168}' +
            ']'
        }
      });
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.args[0], [null, [{
        name: 'file1', type: 'file', path: 'file1.zip', description: 'desc.',
        revision: 5,fingerprint: '123',size: 168
      }, {
        name: 'file2', type: 'file', path: 'file2.zip', description: 'desc.',
        revision: 5,fingerprint: '123',size: 168
      }]]);
    });

    it('properly calls the callback when there is an error', function() {
      const callback = sinon.stub();
      charmstore.getResources('cs:xenial/ghost-4', callback);
      const bakeryGet = charmstore.bakery.get;
      assert.equal(bakeryGet.callCount, 1);
      const requestPath = bakeryGet.args[0][0];
      assert.equal(requestPath, 'local/v5/xenial/ghost-4/meta/resources');
      // Call the error request callback.
      bakeryGet.args[0][2]('not found');
      assert.equal(callback.callCount, 1);
      assert.deepEqual(callback.args[0], ['not found', null]);
    });
  });
});
