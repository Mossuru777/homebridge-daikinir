import * as request_promise_native from 'request-promise-native';

const PluginName = 'homebridge-daikinir';
const AccessoryName = 'daikinir';

let Service, Characteristic, UUIDGen;

enum DaikinAcMode {
    Auto = 'auto',
    Cold = 'cold',
    Fan = 'fan',
    Warm = 'warm'
}

interface DaikinACState {
    power: boolean;
    mode: DaikinAcMode;
    targetCelsiusTemp: number;
    swing: boolean;
    powerful: boolean;
}

class DaikinIrAccessory {
    private static readonly Model = 'Daikin IR Controlled Air Conditioner';

    private static readonly ColdDefaultTemp = 25;
    private static readonly WarmDefaultTemp = 19;

    private readonly accessoryName: string;

    private informationService: any;
    private mainPowerSwitchService: any;
    private thermostatService: any;
    private swingSwitchService: any;
    private powerfulSwitchService: any;

    // target settings
    private currentState: DaikinACState = {
        power: false,
        mode: DaikinAcMode.Cold,
        targetCelsiusTemp: DaikinIrAccessory.ColdDefaultTemp,
        swing: true,
        powerful: false
    };
    private temperatureDisplayUnits;

    constructor(private readonly log: (msg) => any, private readonly config: any) {
        this.accessoryName = `${this.config.name.replace(/-/g, ' ')}`;
        this.temperatureDisplayUnits = Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    // Accessory related methods
    getServices() {
        // register AccessoryInformation Service
        this.informationService = new Service.AccessoryInformation();
        this.informationService
            .setCharacteristic(Characteristic.Manufacturer, PluginName)
            .setCharacteristic(Characteristic.Model, DaikinIrAccessory.Model)
            .setCharacteristic(Characteristic.Name, this.config.name)
            .setCharacteristic(Characteristic.SerialNumber, UUIDGen.generate(this.config.name));

        // register Main Power Switch Service
        this.mainPowerSwitchService = new Service.Switch(`${this.accessoryName} MainPower`);
        this.mainPowerSwitchService.getCharacteristic(Characteristic.On)
            .on('get', this.getMainPowerState.bind(this))
            .on('set', this.setMainPowerState.bind(this));

        // register Thermostat Service
        this.thermostatService = new Service.Thermostat(this.accessoryName);

        this.thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .on('get', this.getCurrentHeatingCoolingState.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .on('get', this.getTargetHeatingCoolingState.bind(this))
            .on('set', this.setTargetHeatingCoolingState.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.TargetTemperature)
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on('get', this.getTemperatureDisplayUnits.bind(this))
            .on('set', this.setTemperatureDisplayUnits.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                maxValue: 32,
                minValue: 18,
                minStep: 1,
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setCoolingTemperature.bind(this));

        this.thermostatService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                maxValue: 30,
                minValue: 14,
                minStep: 1,
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setHeatingTemperature.bind(this));

        // register Swing Switch Service
        this.swingSwitchService = new Service.Switch(`${this.accessoryName} Swing`);
        this.swingSwitchService.getCharacteristic(Characteristic.On)
            .on('get', this.getSwingState.bind(this))
            .on('set', this.setSwingState.bind(this));

        // register Powerful Switch Service
        this.powerfulSwitchService = new Service.Switch(`${this.accessoryName} Powerful`);
        this.powerfulSwitchService.getCharacteristic(Characteristic.On)
            .on('get', this.getPowerfulState.bind(this))
            .on('set', this.setPowerfulState.bind(this));

        return [this.informationService,this.mainPowerSwitchService, this.thermostatService,
            this.swingSwitchService, this.powerfulSwitchService];
    }

    identify(callback) {
      callback();
    }

    // Main Power Switch Characteristic getter/setter
    getMainPowerState(callback) {
        callback(null, this.currentState.power);
    }

    setMainPowerState(value, callback) {
        const newState = this.copyState();
        newState.power = value;
        this.sendStateToAPI(newState, callback);
    }

    // Thermostat Service Characteristic getter/setter

    getCurrentHeatingCoolingState(callback) {
        const state = (() => {
            if (!this.currentState.power) {
                return Characteristic.CurrentHeatingCoolingState.OFF;
            }
            switch (this.currentState.mode) {
                case DaikinAcMode.Auto:
                case DaikinAcMode.Fan:
                    return Characteristic.CurrentHeatingCoolingState.OFF;
                case DaikinAcMode.Cold:
                    return Characteristic.CurrentHeatingCoolingState.COOL;
                case DaikinAcMode.Warm:
                    return Characteristic.CurrentHeatingCoolingState.HEAT;
            }
        })();
        callback(null, state);
    }

    getTargetHeatingCoolingState(callback) {
        const state = (() => {
            if (!this.currentState.power) {
                return Characteristic.TargetHeatingCoolingState.OFF;
            }
            switch (this.currentState.mode) {
                case DaikinAcMode.Auto:
                case DaikinAcMode.Fan:
                    return Characteristic.TargetHeatingCoolingState.OFF;
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
        newState.mode = value;
        switch (value) {
            case Characteristic.TargetHeaterCoolerState.AUTO:
                callback(new Error('Can\'t set HeatingCoolingState to Auto.'));
                return;
            case Characteristic.TargetHeaterCoolerState.COOL:
                newState.targetCelsiusTemp = DaikinIrAccessory.ColdDefaultTemp;
                break;
            case Characteristic.TargetHeaterCoolerState.HEAT:
                newState.targetCelsiusTemp = DaikinIrAccessory.WarmDefaultTemp;
                break;
            default:
                callback(new Error(`Unknown HeaterCoolerState ${value}`));
                return;
        }
        this.sendStateToAPI(newState, callback);
    }

    getCurrentTemperature(callback) {
        callback(null, this.getCurrentDisplayUnitTemp(25));
    }

    getTargetTemperature(callback) {
        callback(null, this.getCurrentDisplayUnitTemp(this.currentState.targetCelsiusTemp));
    }

    setTargetTemperature(value, callback) {
        const newState = this.copyState();
        newState.targetCelsiusTemp = this.getCelsiusTemp(value);
        this.sendStateToAPI(newState, callback);
    }

    setCoolingTemperature(value, callback) {
        const newState = this.copyState();
        newState.mode = DaikinAcMode.Cold;
        newState.targetCelsiusTemp = this.getCelsiusTemp(value);
        this.sendStateToAPI(newState, callback);
    }

    setHeatingTemperature(value, callback) {
        const newState = this.copyState();
        newState.mode = DaikinAcMode.Warm;
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

    // Swing Switch Characteristic getter/setter
    getSwingState(callback) {
        callback(null, this.currentState.swing);
    }

    setSwingState(value, callback) {
        const newState = this.copyState();
        newState.swing = value;
        this.sendStateToAPI(newState, callback);
    }

    // Powerful Switch Characteristic getter/setter
    getPowerfulState(callback) {
        callback(null, this.currentState.powerful);
    }

    setPowerfulState(value, callback) {
        if (value === this.currentState.powerful) {
            callback();
            return;
        }
        const newState = this.copyState();
        newState.powerful = value;
        this.sendStateToAPI(newState, callback);
    }

    // Common Characteristic getter/setter
    private sendStateToAPI(newState: DaikinACState, callback) {
        let url = `${this.config.api_url}?power=${newState.power}`;
        if (newState.power) {
            url += `&mode=${newState.mode}&temp=${newState.targetCelsiusTemp}&swing=${newState.swing}&powerful=${newState.powerful}`;
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
                    } else {
                        return body;
                    }
                } catch {
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

    private getCurrentDisplayUnitTemp(celsius_temp) {
        if (this.temperatureDisplayUnits === Characteristic.TemperatureDisplayUnits.CELSIUS) {
            return celsius_temp;
        } else {
            return celsius_temp + 32;
        }
    }

    private getCelsiusTemp(unknown_unit_temp) {
        if (this.temperatureDisplayUnits === Characteristic.TemperatureDisplayUnits.CELSIUS) {
            return unknown_unit_temp;
        } else {
            return unknown_unit_temp - 32;
        }
    }

    private copyState(): DaikinACState {
        return {
            power: this.currentState.power,
            mode: this.currentState.mode,
            targetCelsiusTemp: this.currentState.targetCelsiusTemp,
            swing: this.currentState.swing,
            powerful: this.currentState.powerful
        };
    }
}

export = (homebridge) => {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerAccessory(PluginName, AccessoryName, DaikinIrAccessory);
};
