import * as request_promise_native from 'request-promise-native';

const PluginName = 'homebridge-daikinir';
const AccessoryName = 'daikinir';

let Service, Characteristic, UUIDGen;

enum DaikinAcMode {
    Auto = 'auto',
    Cold = 'cold',
    Dry = 'dry',
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

    private static readonly AutoDefaultTemp = 0;
    private static readonly ColdDefaultTemp = 25;
    private static readonly WarmDefaultTemp = 19;
    private static readonly DryDefaultTemp = 0;
    // private static readonly FanFixedTemp = 25;

    private readonly accessoryName: string;

    // target settings
    private currentState: DaikinACState = {
        power: false,
        mode: DaikinAcMode.Auto,
        targetCelsiusTemp: DaikinIrAccessory.AutoDefaultTemp,
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
        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, PluginName)
            .setCharacteristic(Characteristic.Model, DaikinIrAccessory.Model)
            .setCharacteristic(Characteristic.Name, this.config.name)
            .setCharacteristic(Characteristic.SerialNumber, UUIDGen.generate(this.config.name));

        // register HeaterCooler Service
        const heaterCoolerService = new Service.HeaterCooler(this.accessoryName);

        heaterCoolerService.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({
                maxValue: 32,
                minValue: 18,
                minStep: 1,
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setCoolingTemperature.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({
                maxValue: 30,
                minValue: 14,
                minStep: 1,
            })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setHeatingTemperature.bind(this));

        heaterCoolerService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .on('get', this.getTemperatureDisplayUnits.bind(this))
            .on('set', this.setTemperatureDisplayUnits.bind(this));

        // register HumidifierDehumidifier Service
        const humidifierDehumidifierService = new Service.HumidifierDehumidifier(this.accessoryName);

        humidifierDehumidifierService.getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .on('get', this.getCurrentRelativeHumidity.bind(this));

        humidifierDehumidifierService.getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
            .on('get', this.getCurrentHumidifierDehumidifierState.bind(this));

        humidifierDehumidifierService.getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
            .on('get', this.getTargetHumidifierDehumidifierState.bind(this))
            .on('set', this.setTargetHumidifierDehumidifierState.bind(this));

        humidifierDehumidifierService.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        humidifierDehumidifierService.getCharacteristic(Characteristic.SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));

        return [informationService, heaterCoolerService, humidifierDehumidifierService];
    }

    identify(callback) {
      callback();
    }

    // HeaterCooler Service Characteristic getter/setter

    getCurrentHeaterCoolerState(callback) {
        const state = (() => {
            if (!this.currentState.power) {
                return Characteristic.CurrentHeaterCoolerState.INACTIVE;
            }
            switch (this.currentState.mode) {
                case DaikinAcMode.Auto:
                    return Characteristic.CurrentHeaterCoolerState.INACTIVE;
                case DaikinAcMode.Cold:
                    return Characteristic.CurrentHeaterCoolerState.COOL;
                case DaikinAcMode.Warm:
                    return Characteristic.CurrentHeaterCoolerState.HEAT;
                case DaikinAcMode.Dry:
                case DaikinAcMode.Fan:
                    return Characteristic.CurrentHeaterCoolerState.IDLE;
            }
        })();
        callback(null, state);
    }

    getTargetHeaterCoolerState(callback) {
        const state = (() => {
            if (!this.currentState.power) {
                return Characteristic.TargetHeaterCoolerState.AUTO;
            }
            switch (this.currentState.mode) {
                case DaikinAcMode.Cold:
                    return Characteristic.TargetHeaterCoolerState.COOL;
                case DaikinAcMode.Warm:
                    return Characteristic.TargetHeaterCoolerState.HEAT;
                case DaikinAcMode.Auto:
                case DaikinAcMode.Dry:
                case DaikinAcMode.Fan:
                    return Characteristic.TargetHeaterCoolerState.AUTO;
            }
        })();
        callback(null, state);
    }
    setTargetHeaterCoolerState(value, callback) {
        const newState = this.copyState();
        newState.mode = value;
        switch (value) {
            case Characteristic.TargetHeaterCoolerState.AUTO:
                newState.targetCelsiusTemp = DaikinIrAccessory.AutoDefaultTemp;
                break;
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

    private setTargetTemperature(mode: DaikinAcMode, value, callback) {
        const newState = this.copyState();
        newState.mode = mode;
        newState.targetCelsiusTemp = this.getCelsiusTemp(value);
        this.sendStateToAPI(newState, callback);
    }

    setCoolingTemperature(value, callback) {
        this.setTargetTemperature(DaikinAcMode.Cold, value, callback);
    }

    setHeatingTemperature(value, callback) {
        this.setTargetTemperature(DaikinAcMode.Warm, value, callback);
    }

    getTemperatureDisplayUnits(callback) {
        callback(null, this.temperatureDisplayUnits);
    }
    setTemperatureDisplayUnits(value, callback) {
        this.temperatureDisplayUnits = value;
        callback();
    }

    // HumidifierDehumidifier Characteristic getter/setter
    getCurrentRelativeHumidity(callback) {
        callback(null, 50);
    }

    getCurrentHumidifierDehumidifierState(callback) {
        if (callback !== undefined) {
            const state = (() => {
                if (!this.currentState.power) {
                    return Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
                }
                if (this.currentState.mode === DaikinAcMode.Dry) {
                    return Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING;
                } else {
                    return Characteristic.CurrentHumidifierDehumidifierState.IDLE;
                }
            })();
            callback(null, state);
        }
    }

    getTargetHumidifierDehumidifierState(callback) {
        if (callback !== undefined) {
            const state = (this.currentState.power && this.currentState.mode === DaikinAcMode.Dry) ?
                Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIE :
                Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER;
            callback(null, state);
        }
    }

    setTargetHumidifierDehumidifierState(value, callback) {
        const newState = this.copyState();
        if (value === Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER) {
            if (this.currentState.mode !== DaikinAcMode.Dry) {
                newState.mode = DaikinAcMode.Dry;
                newState.targetCelsiusTemp = DaikinIrAccessory.DryDefaultTemp;
            }
        } else if (value === Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER) {
            if (this.currentState.mode === DaikinAcMode.Dry) {
                newState.mode = DaikinAcMode.Auto;
                newState.targetCelsiusTemp = DaikinIrAccessory.AutoDefaultTemp;
            }
        } else {
            if (callback !== undefined) {
                callback(new Error('Dehumidifier can\'t be set to the specified state.'));
            }
            return;
        }
        this.sendStateToAPI(newState, callback);
    }

    // Common Characteristic getter/setter

    getActive(callback) {
        if (callback !== undefined) {
            callback(null, this.currentState.power ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        }
    }
    setActive(value, callback) {
        const newState = this.copyState();
        newState.power = value === Characteristic.Active.ACTIVE;
        this.sendStateToAPI(newState, callback);
    }

    getSwingMode(callback) {
        if (callback !== undefined) {
            const state = this.currentState.swing ?
                Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
            callback(null, state);
        }
    }

    setSwingMode(value, callback) {
        const newState = this.copyState();
        newState.swing = value === Characteristic.SwingMode.SWING_ENABLED;
        this.sendStateToAPI(newState, callback);
    }

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
