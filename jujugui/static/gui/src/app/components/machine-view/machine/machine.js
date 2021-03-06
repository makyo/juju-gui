/* Copyright (C) 2017 Canonical Ltd. */
'use strict';

const PropTypes = require('prop-types');
const React = require('react');
const ReactDnD = require('react-dnd');
const shapeup = require('shapeup');

const ButtonRow = require('../../button-row/button-row');
const Constraints = require('../../constraints/constraints');
const Machine = require('../../shared/machine/machine');
const MachineViewMachineUnit = require('../machine-unit/machine-unit');


const dropTarget = {
  /**
    Called when something is dropped on the machine.
    See: http://gaearon.github.io/react-dnd/docs-drop-target.html
    @param {Object} props The component props.
    @param {Object} monitor A DropTargetMonitor.
    @param {Object} component The component that is being dropped onto.
  */
  drop: function(props, monitor, component) {
    props.sendAnalytics('Machine View', 'Drop Target', 'Machine');
    props.dropUnit(monitor.getItem().unit, props.machineAPI.machine.id);
  },

  /**
    Called to check whether something can be dropped on the component.
    @param {Object} props The component props.
    @param {Object} monitor A DropTargetMonitor.
  */
  canDrop: function(props, monitor) {
    return !props.acl.isReadOnly() && !props.machineAPI.machine.deleted;
  }
};

/**
  Provides props to be injected into the component.
  @param {Object} connect The connector.
  @param {Object} monitor A DropTargetMonitor.
*/
const collect = function(connect, monitor) {
  return {
    canDrop: monitor.canDrop(),
    connectDropTarget: connect.dropTarget(),
    isOver: monitor.isOver()
  };
};

class MachineViewMachine extends React.Component {
  constructor() {
    super();
    this.state = {
      constraints: null,
      showForm: false
    };
  }

  /**
    Toggle the display of the constraints form.
  */
  _toggleForm() {
    this.setState({showForm: !this.state.showForm});
  }

  /**
    Update the state with the new constraints.

    @param constraints {Object} The new constraints.
  */
  _updateConstraints(constraints) {
    this.setState({constraints: constraints});
  }

  /**
    Set the new constraints on the machine.
  */
  _setConstraints() {
    const constraints = this.state.constraints;
    const series = constraints.series || null;
    // The series is updated separately from the constraints, so remove it
    // from the object that is passed to the update constraints method.
    delete constraints.series;
    const id = this.props.machineAPI.machine.id;
    const modelAPI = this.props.modelAPI;
    modelAPI.updateMachineConstraints(id, constraints);
    modelAPI.updateMachineSeries(id, series);
    this._toggleForm();
  }

  /**
    Generate the constraints form.

    @returns {Object} the form JSX.
  */
  _generateConstraintsForm() {
    if (!this.state.showForm) {
      return null;
    }
    const machine = this.props.machineAPI.machine;
    const disabled = this.props.acl.isReadOnly();
    const units = this.props.dbAPI.units.filterByMachine(
      machine.id, this.props.type === 'machine');
    const buttons = [{
      title: 'Cancel',
      action: this._toggleForm.bind(this),
      type: 'base'
    }, {
      title: 'Update',
      action: this._setConstraints.bind(this),
      type: 'neutral',
      disabled: disabled
    }];
    return (
      <div className="add-machine__constraints">
        <h4 className="add-machine__title">
          Update constraints
        </h4>
        <Constraints
          constraints={this.props.parseConstraints(machine.constraints)}
          currentSeries={machine.series}
          disabled={disabled}
          hasUnit={!!units.length}
          providerType={this.props.modelAPI.providerType}
          series={this.props.machineAPI.series}
          valuesChanged={this._updateConstraints.bind(this)} />
        <ButtonRow
          buttons={buttons}
          key="buttons" />
      </div>);
  }

  /**
    Generate the hardware for a machine.
    @returns {Array} the machine hardware details.
  */
  _generateHardware() {
    const props = this.props;
    if (props.type === 'container' || !props.showConstraints ||
        this.state.showForm) {
      return;
    }
    const machineAPI = props.machineAPI;
    return machineAPI.parseMachineDetails(machineAPI.machine);
  }

  /**
    Generate the unit icons for the machine.
    @returns {Object} the unit elements.
  */
  _generateUnits() {
    if (this.state.showForm) {
      return null;
    }
    const props = this.props;
    const includeChildren = props.type === 'machine';
    const units = props.dbAPI.units.filterByMachine(
      props.machineAPI.machine.id, includeChildren);
    if (units.length === 0) {
      return;
    }
    const components = [];
    units.forEach(unit => {
      const service = props.dbAPI.applications.getById(unit.service);
      if (props.type === 'machine' && (service.get('hide')
        || service.get('fade'))) {
        return;
      }
      const propTypes = (
        MachineViewMachineUnit.DecoratedComponent.propTypes);
      components.push(
        <MachineViewMachineUnit
          acl={props.acl.reshape(propTypes.acl)}
          icon={service.get('icon')}
          key={unit.id}
          machineType={props.type}
          removeUnit={props.machineAPI.removeUnit}
          sendAnalytics={props.sendAnalytics}
          unit={unit} />);
    });
    return (
      <ul className="machine-view__machine-units machine__units">
        {components}
      </ul>);
  }

  /**
    Handle destroying a machine.
  */
  _destroyMachine() {
    const props = this.props;
    props.modelAPI.destroyMachines([props.machineAPI.machine.id], true);
  }

  /**
    Handle selecting a machine.
  */
  _handleSelectMachine() {
    const selectMachine = this.props.machineAPI.selectMachine;
    if (selectMachine) {
      selectMachine(this.props.machineAPI.machine.id, false);
    }
  }

  /**
    Generate the classes for the machine.
    @returns {String} The collection of class names.
  */
  _generateClasses() {
    const machine = this.props.machineAPI.machine;
    const classes = {
      'machine-view__machine': true,
      'machine-view__machine--drop': this.props.isOver && this.props.canDrop,
      'machine-view__machine--selected': this.props.machineAPI.selected,
      'machine-view__machine--uncommitted': machine.deleted ||
        machine.commitStatus === 'uncommitted'
    };
    return Object.keys(classes).filter(className => classes[className]);
  }

  _sshToMachine() {
    const machine = this.props.machineAPI.machine.id;
    const commands = [`juju ssh ${machine}`];
    this.props.changeState({terminal: commands});
  }

  _generateSSHAction() {
    const props = this.props;
    const machine = this.props.machineAPI.machine;
    if (props.type !== 'container' && props.showSSHButton &&
        machine.commitStatus !== 'uncommitted') {
      return this._sshToMachine.bind(this);
    }
  }

  render() {
    const machine = this.props.machineAPI.machine;
    let menuItems = [{
      label: 'Destroy',
      action: (!this.props.acl.isReadOnly() && this._destroyMachine.bind(this)) || null
    }];
    if (this.props.type === 'machine' &&
        machine.commitStatus === 'uncommitted') {
      menuItems.push({
        label: 'Update constraints',
        action: (!this.props.acl.isReadOnly() && this._toggleForm.bind(this)) || null
      });
    }
    // Wrap the returned components in the drop target method.
    return this.props.connectDropTarget(
      <div>
        <Machine
          classes={this._generateClasses()}
          hardware={this._generateHardware()}
          isContainer={this.props.type === 'container'}
          machine={{
            name: machine.displayName,
            root: machine.root,
            region: this.props.modelAPI.region,
            series: machine.series,
            status: machine.commitStatus || machine.agent_state
          }}
          menuItems={menuItems}
          onClick={this._handleSelectMachine.bind(this)}
          sshAction={this._generateSSHAction()}
          sshLabel={machine.public_address}>
          {this._generateUnits()}
          {this._generateConstraintsForm()}
          <div className="machine-view__machine-drop-target">
            <div className="machine-view__machine-drop-message">
              Add to {machine.displayName}
            </div>
          </div>
        </Machine>
      </div>
    );
  }
};

MachineViewMachine.propTypes = {
  acl: shapeup.shape({
    isReadOnly: PropTypes.func.isRequired,
    reshape: shapeup.reshapeFunc
  }).frozen.isRequired,
  canDrop: PropTypes.bool.isRequired,
  changeState: PropTypes.func,
  connectDropTarget: PropTypes.func.isRequired,
  dbAPI: shapeup.shape({
    applications: PropTypes.object.isRequired,
    units: PropTypes.object.isRequired
  }).isRequired,
  dropUnit: PropTypes.func.isRequired,
  isOver: PropTypes.bool.isRequired,
  machineAPI: shapeup.shape({
    parseMachineDetails: PropTypes.func,
    machine: PropTypes.object.isRequired,
    removeUnit: PropTypes.func,
    selectMachine: PropTypes.func,
    selected: PropTypes.bool,
    series: PropTypes.array
  }).isRequired,
  modelAPI: shapeup.shape({
    destroyMachines: PropTypes.func.isRequired,
    providerType: PropTypes.string,
    region: PropTypes.string,
    updateMachineConstraints: PropTypes.func,
    updateMachineSeries: PropTypes.func
  }).isRequired,
  parseConstraints: PropTypes.func.isRequired,
  sendAnalytics: PropTypes.func.isRequired,
  showConstraints: PropTypes.bool,
  showSSHButton: PropTypes.bool,
  type: PropTypes.string.isRequired
};

module.exports = ReactDnD.DropTarget('unit', dropTarget, collect)(MachineViewMachine);
