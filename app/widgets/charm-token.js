'use strict';


/**
 * Provides the Charm Token widget, for display a small unit of charm
 * information.
 *
 * @namespace juju
 * @module widgets
 * @submodule browser
 */
YUI.add('browser-charm-token', function(Y) {

  var ns = Y.namespace('juju.widgets.browser');
  ns.EVENT_CHARM_ADD = 'charm-token-add';
  ns.CharmToken = Y.Base.create('CharmToken', Y.Widget, [
    Y.Event.EventTracker,
    Y.WidgetChild
  ], {
    TEMPLATE: Y.namespace('juju.views').Templates['charm-token'],

    /**
     * Create the nodes required by this widget and attach them to the DOM.
     *
     * @method renderUI
     */
    renderUI: function() {
      var content = this.TEMPLATE(this.getAttrs());
      var container = this.get('contentBox');
      container.setHTML(content);
      container.ancestor('.yui3-charmtoken').addClass('yui3-u');
    }

  }, {
    ATTRS: {
      /**
       * @attribute description
       * @default ''
       * @type {String}
       */
      description: {
        value: ''
      },

      /**
       * @attribute icon
       * @default ''
       * @type {String}
       */
      icon: {
        value: ''
      },

      /**
       * @attribute name
       * @default ''
       * @type {String}
       */
      name: {
        value: ''
      },

      /**
       * @attribute recent_commit_count
       * @default undefined
       * @type {Number}
       */
      recent_commit_count: {},

      /**
       * @attribute recent_download_count
       * @default undefined
       * @type {Number}
       */
      recent_download_count: {}
    }
  });

}, '0.1.0', {
  requires: [
    'base',
    'event-tracker',
    'handlebars',
    'juju-templates',
    'juju-view-utils',
    'widget',
    'widget-child'
  ]
});
