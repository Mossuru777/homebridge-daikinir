"use strict";
const request_promise_native = require("request-promise-native");
const PluginName = 'homebridge-daikinir';
const AccessoryName = 'daikinir';
let Service, Characteristic, UUIDGen;
var DaikinAcMode;
(function (DaikinAcMode) {
    DaikinAcMode["Cold"] = "cold";
    DaikinAcMode["Warm"] = "warm";
})(DaikinAcMode || (DaikinAcMode = {}));
class DaikinAcTemperatureRange {
    constructor(mid, max, min) {
        this.mid = mid;
        this.max = max;
        this.min = min;
    }
    isInRange(temperature) {
        return temperature >= this.min && temperature <= this.max;
    }
}
class DaikinIrAccessory {
    constructor(log, config) {
        this.log = log;
        this.config = config;
        // private swingSwitchService: any;
        // private powerfulSwitchService: any;
        // target settings
        this.currentState = {
            power: false,
            mode: DaikinAcMode.Cold,
            targetCelsiusTemp: DaikinIrAccessory.ColdTempRange.mid,
            swing: true,
            powerful: false
        };
        this.accessoryName = `${this.config.name.replace(/-/g, ' ')}`;
        this.temperatureDisplayUnits = Characteristic.TemperatureDisplayUnits.CELSIUS;
        // register AccessoryInformation Service
        this.informationService = new Service.AccessoryInformation();
        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, PluginName)
            .setCharacteristic(Characteristic.Model, DaikinIrAccessory.Model)
            .setCharacteristic(Characteristic.Name, this.config.name)
            .setCharacteristic(Characteristic.SerialNumber, UUIDGen.generate(this.config.name));
        // register Thermostat Service
        this.thermostatService = new Service.Thermostat(this.accessoryName);
        this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on('get', this.getTargetHeatingCoolingState.bind(this))
            .on('set', this.setTargetHeatingCoolingState.bind(this));
        this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));
        this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on('get', this.getTemperatureDisplayUnits.bind(this))
            .on('set', this.setTemperatureDisplayUnits.bind(this));
    }
    // Accessory related methods
    getServices() {
        return [this.informationService, this.thermostatService];
    }
    identify(callback) {
        callback();
    }
    // Thermostat Service Characteristic getter/setter
    getTargetHeatingCoolingState(callback) {
        const state = (() => {
            if (!this.currentState.power) {
                return Characteristic.TargetHeatingCoolingState.OFF;
            }
            switch (this.currentState.mode) {
                case DaikinAcMode.Cold:
                    return Characteristic.TargetHeatingCoolingState.COOL;
                case DaikinAcMode.Warm:
                    return Characteristic.TargetHeatingCoolingState.HEAT;
            }
        })();
        callback(null, state);
    }
    setTargetHeatingCoolingState(value, callback) {
        const newState = this.copyState();
        if (value === Characteristic.TargetHeatingCoolingState.OFF) {
            newState.power = false;
            this.sendStateToAPI(newState, callback);
            return;
        }
        newState.power = true;
        switch (value) {
            case Characteristic.TargetHeatingCoolingState.COOL:
                newState.mode = DaikinAcMode.Cold;
                break;
            case Characteristic.TargetHeatingCoolingState.HEAT:
                newState.mode = DaikinAcMode.Warm;
                break;
            case Characteristic.TargetHeatingCoolingState.AUTO:
                callback(new Error('Can\'t set HeatingCoolingState to Auto.'));
                return;
            default:
                callback(new Error(`Unknown HeatingCoolingState ${value}`));
                return;
        }
        const temperatureRange = newState.mode === DaikinAcMode.Cold ? DaikinIrAccessory.ColdTempRange : DaikinIrAccessory.WarmTempRange;
        if (!temperatureRange.isInRange(newState.targetCelsiusTemp)) {
            newState.targetCelsiusTemp = temperatureRange.mid;
            this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
                .updateValue(this.getCurrentDisplayUnitTemp(newState.targetCelsiusTemp));
        }
        this.sendStateToAPI(newState, callback);
    }
    getTargetTemperature(callback) {
        callback(null, this.getCurrentDisplayUnitTemp(this.currentState.targetCelsiusTemp));
    }
    setTargetTemperature(value, callback) {
        const newState = this.copyState();
        newState.targetCelsiusTemp = this.getCelsiusTemp(value);
        this.sendStateToAPI(newState, callback);
    }
    getTemperatureDisplayUnits(callback) {
        callback(null, this.temperatureDisplayUnits);
    }
    setTemperatureDisplayUnits(value, callback) {
        this.temperatureDisplayUnits = value;
        callback();
    }
    // Common Characteristic getter/setter
    sendStateToAPI(newState, callback) {
        let url = `${this.config.api_url}?power=${newState.power}`;
        if (newState.power) {
            // url += `&mode=${newState.mode}&temp=${newState.targetCelsiusTemp}&swing=${newState.swing}&powerful=${newState.powerful}`;
            url += `&mode=${newState.mode}&temp=${newState.targetCelsiusTemp}`;
        }
        this.log(newState);
        this.log(url);
        request_promise_native.get({
            url: url,
            simple: false,
            transform2xxOnly: false,
            transform: (body, response) => {
                if (response.statusCode === 204) {
                    return body;
                }
                try {
                    const json = JSON.parse(body);
                    if (json.hasOwnProperty('messages')) {
                        return json.messages.join('\n');
                    }
                    else {
                        return body;
                    }
                }
                catch (_a) {
                    return body;
                }
            }
        })
            .then((message) => {
            this.currentState = newState;
            if (message !== undefined && message !== '') {
                this.log(message);
            }
            callback();
        })
            .catch(message => {
            if (message !== undefined && message !== '') {
                this.log(`error occurred: ${message}`);
            }
            callback(new Error(message));
        });
    }
    getCurrentDisplayUnitTemp(celsius_temp) {
        if (this.temperatureDisplayUnits === Characteristic.TemperatureDisplayUnits.CELSIUS) {
            return celsius_temp;
        }
        else {
            return celsius_temp + 32;
        }
    }
    getCelsiusTemp(unknown_unit_temp) {
        if (this.temperatureDisplayUnits === Characteristic.TemperatureDisplayUnits.CELSIUS) {
            return unknown_unit_temp;
        }
        else {
            return unknown_unit_temp - 32;
        }
    }
    copyState() {
        return {
            power: this.currentState.power,
            mode: this.currentState.mode,
            targetCelsiusTemp: this.currentState.targetCelsiusTemp,
            swing: this.currentState.swing,
            powerful: this.currentState.powerful
        };
    }
}
DaikinIrAccessory.Model = 'Daikin IR Controlled Air Conditioner';
DaikinIrAccessory.ColdTempRange = new DaikinAcTemperatureRange(25, 32, 18);
DaikinIrAccessory.WarmTempRange = new DaikinAcTemperatureRange(19, 30, 14);
module.exports = (homebridge) => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    homebridge.registerAccessory(PluginName, AccessoryName, DaikinIrAccessory);
};
//# sourceMappingURL=index.js.map