/* global Module */

/**
 * Magic Mirror
 * Module: MMM-WeatherStation
 *
 * By David Dearden
 * MIT Licensed.
 */

/**
 * Register the module with the MagicMirror program
 */
Module.register("MMM-WeatherStation", {
	
	/**
	 * The default configuration options
	 */
	defaults: {
		units: config.units,
		sendTemperature: true,
		sendHumidity: true,
		showTemperature: false,
		showHumidity: false,
		iconView: true,
		temperatureText: null, // Set in self.start() becuase access to self.translate is needed
		humidityText: null, // Set in self.start() becuase access to self.translate is needed
		fontSize: "large",
		decimalSymbol: null, // Set in self.start() becuase access to self.translate is needed
		roundTemperature: false,
		roundHumidity: false,
		scriptPath: null, // Set in self.start() becuase access to self.data.path is needed
		url: "",
		initialLoadDelay: 0, // Seconds, minimum 0
		animationSpeed: 0, // Milliseconds, minimum 0
		retryDelay: 10, // Seconds, minimum 10
		updateInterval: 1, // Minutes, minimum 0.5
		developerMode: false
	},
	
	/**
	 * The minimum version of magic mirror that is required for this module to run. 
	 */
	requiresVersion: "2.2.1",
	
	/**
	 * Override the start function.  Set some instance variables and validate the selected 
	 * configuration options before loading the rest of the module.  
	 */
	start: function() {
		var self = this;
		self.instanceID = self.identifier + "_" + Math.random().toString().substring(2);
		self.sendSocketNotification("INIT", { instanceID: self.instanceID } );
		self.updateTimer = null;
		self.sensorData = null;
		self.loaded = false;
		self.defaults.scriptPath = self.data.path + "getdata.pl";
		self.defaults.url = '';
		self.defaults.decimalSymbol = self.translate("DECIMAL_SYMBOL");
		self.maxDataAttempts = 3;
		self.validUnits = [ "metric", "imperial", "default" ];
		var unitMap = { "metric": "celcius", "imperial": "fahrenheit", "default": "kelvin" };
		self.validFontSizes = [ "x-small", "small", "medium", "large", "x-large" ];
		self.currentweatherLoaded = false;
		
		// Process and validate configuration options
		if (axis.isNumber(self.config.updateInterval) && self.config.updateInterval >= 0.5) { self.config.updateInterval = self.config.updateInterval * 60 * 1000; }
		else { self.config.updateInterval = self.defaults.updateInterval * 60 * 1000; }

		if (axis.isNumber(self.config.retryDelay) && self.config.retryDelay >= 10) { self.config.retryDelay = self.config.retryDelay * 1000; }
		else { self.config.retryDelay = self.defaults.retryDelay * 1000; }

		if (axis.isNumber(self.config.initialLoadDelay) && self.config.initialLoadDelay >= 0) { self.config.initialLoadDelay = self.config.initialLoadDelay * 1000; }
		else { self.config.initialLoadDelay = self.defaults.initialLoadDelay * 1000; }

		if (!axis.isNumber(self.config.retryDelay) || self.config.retryDelay < 0) { self.config.animationSpeed = self.defaults.animationSpeed; }

		if (!axis.isString(self.config.scriptPath) || self.config.scriptPath.length < 1 ) { self.config.scriptPath = self.defaults.scriptPath; }
		if (!self.validUnits.includes(self.config.units)) { self.config.units = self.defaults.units; }
		self.tempUnit = unitMap[self.config.units];
		if (self.tempUnit === "celcius") {
			self.defaults.temperatureText = self.translate("SHOW_TEMP_CELCIUS", { "temperature_var": "{temperature}" });
		} else if (self.tempUnit === "fahrenheit") {
			self.defaults.temperatureText = self.translate("SHOW_TEMP_FAHRENHEIT", { "temperature_var": "{temperature}" });
		} else {
			self.defaults.temperatureText = self.translate("SHOW_TEMP_KELVIN", { "temperature_var": "{temperature}" });
		}
		self.defaults.humidityText = self.translate("SHOW_HUMIDITY", { "humidity_var": "{humidity}" });
		if (!axis.isString(self.config.temperatureText) || self.config.temperatureText.length < 1 ) { self.config.temperatureText = self.defaults.temperatureText; }
		if (!axis.isString(self.config.humidityText) || self.config.humidityText.length < 1 ) { self.config.humidityText = self.defaults.humidityText; }
		if (!axis.isBoolean(self.config.sendTemperature)) { self.config.sendTemperature = self.defaults.sendTemperature; }
		if (!axis.isBoolean(self.config.sendHumidity)) { self.config.sendHumidity = self.defaults.sendHumidity; }
		if (!axis.isBoolean(self.config.roundTemperature)) { self.config.roundTemperature = self.defaults.roundTemperature; }
		if (!axis.isBoolean(self.config.roundHumidity)) { self.config.roundHumidity = self.defaults.roundHumidity; }
		if (!axis.isBoolean(self.config.iconView)) { self.config.iconView = self.defaults.iconView; }
		if (!axis.isString(self.config.decimalSymbol)) { self.config.decimalSymbol = self.defaults.decimalSymbol; }
		if (!self.validFontSizes.includes(self.config.fontSize)) { self.config.fontSize = self.defaults.fontSize; }
		
		// Validate the provided sensorPin
		self.log(("start(): self.data: " + JSON.stringify(self.data)), "dev");
		self.log(("start(): self.config: " + JSON.stringify(self.config)), "dev");
		
		// Start this module - Request the data from the sensor
		if (self.config.initialLoadDelay > 0) {
			self.log(self.translate("INITIAL_DELAY", { "seconds": (self.config.initialLoadDelay / 1000) }));
			setTimeout(function(){ self.getData(1); self.scheduleUpdate(); }, self.config.initialLoadDelay );
		} else {
			self.getData(1);
			self.scheduleUpdate();
		}
	},
	
	/**
	 * Override the suspend function that is called when the module instance is hidden.  
	 * This method stops the update timer.
	 */
	suspend: function() {
	var self = this;
		self.log(self.translate("SUSPENDED") + ".");
		clearInterval(self.updateTimer);
    },
	
	/**
	 * Override the resume function that is called when the module instance is un-hidden.  
	 * This method re-starts the update timer and calls for an update if the update interval
	 * has been passed since the module was suspended. 
	 */
	resume: function() {
		var self = this;
		self.log(self.translate("RESUMED") + ".");
		self.scheduleUpdate();
		var date = new Date();
		var threshold = new Date( self.lastUpdateTime.getTime() + self.config.updateInterval );
		if (date >= threshold) { self.getData(1); }
	},
	
	/**
	 * The scheduleUpdate function starts the auto update timer.  
	 */
	scheduleUpdate: function() {
		var self = this;
		self.updateTimer = setInterval(function() { self.getData(); }, self.config.updateInterval);
		self.log( self.translate("UPDATE_SCHEDULED", { "minutes": (self.config.updateInterval / (1000 * 60)) }) );
    },
	
	/**
	 * The getData function sends a request to the node helper read the data from the sensor
	 * 
	 */
	getData: function() {
		var self = this;
		self.log(self.translate("DATA_REQUESTED"));
		self.sendSocketNotification("GET_DATA", {
			instanceID: self.instanceID,
			scriptPath: self.config.scriptPath,
			notification: "DATA_RECEIVED"
		});
	},
	
	
	/**
	 * Override the socketNotificationReceived function to handle the notifications sent from the node helper
	 * 
	 * @param notification (string) The type of notification sent
	 * @param payload (any) The data sent with the notification
	 */
	socketNotificationReceived: function(notification, payload) {
		var self = this;
		
		// If there is no module ID sent with the notification
		if (!axis.isString(payload.original.instanceID)) {
			if (notification === "LOG") {
				if (payload.translate) { self.log(self.translate(payload.message, payload.translateVars), payload.logType); }
				else { self.log(payload.message, payload.logType); }
			}
			return;
		}
		
		// Filter out notifications for other instances
		if (payload.original.instanceID !== self.instanceID) {
			self.log(("Notification ignored for ID \"" + payload.original.instanceID + "\"."), "dev");
			return;
		}
		
		if (notification === "LOG") {
			if (payload.translate) { self.log(self.translate(payload.message, payload.translateVars), payload.logType); }
			else { self.log(payload.message, payload.logType); }
		} else if (notification === "DATA_RECEIVED") {
			if (payload.isSuccessful) {
				self.log(self.translate("DATA_SUCCESS", { "numberOfAttempts": 1 }));
				self.log(("Sensor Data: " + JSON.stringify(payload.data)), "dev");
				self.sensorData = payload.data;
				self.sendDataNotifications();
				self.loaded = true;
				if (self.data.position) { self.updateDom(self.config.animationSpeed); }
			} else {
				self.log(self.translate("DATA_FAILURE") + "\n" + JSON.stringify(payload.error), "error");
				self.loaded = true;
				if (self.data.position) { self.updateDom(self.config.animationSpeed); }
			}
		}
	},
	
	/**
	 * Send a notification to all the modules with the temperature and humidity.  
	 * Use the INDOOR_TEMPERATURE and INDOOR_HUMIDITY notification types. 
	 */
	sendDataNotifications: function() {
		var self = this;
		
		if (axis.isNull(self.sensorData)) { return; }
		
		if (self.config.sendTemperature && axis.isNumber(self.sensorData['indoor-'+self.tempUnit])) {
			self.sendNotification("INDOOR_TEMPERATURE", self.sensorData['indoor-'+self.tempUnit]);
		}
		
		if (self.config.sendHumidity && axis.isNumber(self.sensorData['indoor-humidity'])) {
			self.sendNotification("INDOOR_HUMIDITY", self.sensorData['indoor-humidity']);
		}
		
	},

	/**
	 * Override the notificationReceived function.  
	 * For now, there are no actions based on system or module notifications.  
	 * 
	 * @param notification (string) The type of notification sent
	 * @param payload (any) The data sent with the notification
	 * @param sender (object) The module that the notification originated from
	 */
	notificationReceived: function(notification, payload, sender) {
		var self = this;

		if (sender) { // If the notification is coming from another module
			if (notification === "CURRENTWEATHER_DATA") {
				if (!self.currentweatherLoaded) {
					self.currentweatherLoaded = true;
					self.sendDataNotifications();
				}
			}
		} else if (notification === "ALL_MODULES_STARTED") {
		}
	},

	getTemplate: function() {
		// No data available
		if (this.sensorData === null || this.sensorData.length === 0) {
			return 'templates/nodata.njk';
		}

		return 'templates/weather_station.njk';
	},

	/**
	 * getTemplateData - Return the data that is included in the rendered Nunjucks remplate. The
	 * whole module instance is returned here, because several functions are called in the template.
	 *
	 * @return {Object} Data to put into templates
	 */
	getTemplateData: function() {
		return { module: this };
	},

	/**
	 * The roundNumber function rounds a number to the specified number of decimal places.  
	 * Use a negative precision value to round to a position left of the decimal.  
	 * This function overcomes the floating-point rounding issues and rounds away from 0.  
	 * 
	 * @param number (number) The number to round
	 * @param precision (number) The position to round to before or after the decimal
	 * @return (number) The rounded number
	 */
	roundNumber: function(number, precision) {

		if (precision >= 0) {
			return Number(Math.round(number + "e" + precision) + "e-" + precision).toFixed(precision);
		} else {
			return Number(Math.round(number + "e-" + Math.abs(precision)) + "e" + Math.abs(precision));
		}
	},


	airPressureDeltaSymbol: function(val) {
		var DeltaSymbol = 'right';
		var DeltaBlink = '';
		if ( val >= 0.15 && val < 1.0 ) {
			DeltaSymbol = 'up'
		} else if ( val >= 1.0 ) {
			DeltaSymbol = 'double-up';
		} else if ( val <= -0.15 && val > -1.0 ) {
			DeltaSymbol = 'down';
		} else if ( val <= -1.0 ) {
			DeltaSymbol = 'double-down';
			if ( airPressureValueTrend <= -2.0 ) {
				DeltaBlink = 'blink';
			}
		}
		return "fa-angle-" + DeltaSymbol
	},

	tempHue: function(temp) {
		var min = -20;
		var max =  35;
		if ( temp < min ) {
			temp = min;
		} else if ( temp > max ) {
			temp = max;
		};
		return Math.round(300 - (temp-min) * (300/(max-min)));
	},

	humiHue: function(humi) {
		var min =  20;
		var max = 100;
		if ( humi < min ) {
			humi = min;
		} else if ( humi > max ) {
			humi = max;
		};
		return Math.round(250 - (max-humi) * (250/(max-min)));
	},

	airpressureHue: function(pressure) {
		var min =  980;
		var max = 1040;
		if ( pressure < min ) {
			pressure = min;
		} else if ( pressure > max ) {
			pressure = max;
		};
		return Math.round(250 - (pressure-min) * (250/(max-min)));
	},

	airpressureTrendHue: function(trend) {
		var min =  -2.0;
		var max =   2.0;
		if ( trend < min ) {
			trend = min;
		} else if ( trend > max ) {
			trend = max;
		};
		return Math.round(250 - (trend-min) * (250/(max-min)));
	},

	co2Hue: function(co2) {
		var min =  400;
		var max = 1500;
		if ( co2 < min ) {
			co2 = min;
		} else if ( co2 > max ) {
			co2 = max;
		};
		return Math.round(150 - (co2-min) * (150/(max-min)));
	},

	/**
	 * The replaceAll function replaces all occurrences of a string within the given string. 
	 * 
	 * @param str (string) The string to search within
	 * @param find (string) The string to find within str
	 * @param replace (string) The string to use as a replacement for the find string
	 * @return (string) A copy of str with all the find occurrences replaced with replace
	 */
	replaceAll: function(str, find, replace) {
		var output = "";
		var idx = str.indexOf(find);
		while (idx >= 0) {
			output += str.substr(0, idx) + replace;
			str = str.substring(idx + find.length);
			idx = str.indexOf(find);
		}
		output += str;
		return output;
	},
	
	/**
	 * Override the getScripts function to load additional scripts used by this module. 
	 */
	getScripts: function() {
		var scripts = [];
		if (typeof axis !== "function") { scripts.push(this.file("scripts/axis.js")); }
		return scripts;
	},


	/**
	 * Override the getStyles function to load CSS files used by this module. 
	 */
	getStyles: function () {
		return [
			"MMM-WeatherStation.css",
			"font-awesome.css"
		];
	},


	/**
	 * Override the getTranslations function to load translation files specific to this module. 
	 */
	getTranslations: function() {
		return {
			en: "translations/en.json"
		};
	},

	/**
	 * The log function is a convenience alias that sends a message to the console.  
	 * This is an alias for the MagicMirror Log functions with a developer mode feature added.  
	 * This function prepends the module name to the message.  
	 * 
	 * @param message (string) The message to be sent to the console
	 * @param type (string) The type of message (dev, error, info, log)
	 */
	log: function(message, type) {
		var self = this;
		if (self.config.developerMode) {
			var date = new Date();
			var time = date.getHours() + ":" + date.getMinutes() + ":" + date.getSeconds();
			message = self.name + ": (" + self.data.index + ")(" + time + ") " + message;
		} else { message = self.name + ": " + message; }
		switch (type) {
			case "error": Log.error(message); break;
			case "warn": Log.warn(message); break;
			case "info": Log.info(message); break;
			case "dev": if (self.config.developerMode) { Log.log(message); } break;
			default: Log.log(message);
		}
	}
	
});
