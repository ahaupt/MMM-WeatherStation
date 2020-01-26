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
	
	/**
	 * Override the getDom function to generate the DOM objects to be displayed for this module instance
	 */
	getDom: function() {
		var self = this;
		var wrapper = document.createElement("div");
		
		if (!self.loaded) {
			wrapper.classList.add("loading");
			wrapper.classList.add("small");
			wrapper.innerHTML += self.translate("LOADING");
			return wrapper;
		}
			
		wrapper.classList.add(self.config.fontSize);
		var temperatureDecimals = self.config.roundTemperature ? 0 : 1;

		var outdoorTemperatureValue = self.roundNumber(self.sensorData['outdoor-'+self.tempUnit], temperatureDecimals).toFixed(temperatureDecimals);
		var outdoorTemperatureMin = self.roundNumber(self.sensorData['outdoor-'+self.tempUnit+'-min'], temperatureDecimals).toFixed(temperatureDecimals);
		var outdoorTemperatureMax = self.roundNumber(self.sensorData['outdoor-'+self.tempUnit+'-max'], temperatureDecimals).toFixed(temperatureDecimals);
		var outdoorDewpointValue = self.roundNumber(self.sensorData['outdoor-dewpoint-'+self.tempUnit], temperatureDecimals).toFixed(temperatureDecimals);
		var airPressureValue = self.roundNumber(self.sensorData['air-pressure'], temperatureDecimals).toFixed(temperatureDecimals);
		var outdoorHumidityValue = self.roundNumber(self.sensorData['outdoor-humidity'], 0);

		var indoorTemperatureValue = self.roundNumber(self.sensorData['indoor-'+self.tempUnit], temperatureDecimals).toFixed(temperatureDecimals);
		var indoorTemperatureMin = self.roundNumber(self.sensorData['indoor-'+self.tempUnit+'-min'], temperatureDecimals).toFixed(temperatureDecimals);
		var indoorTemperatureMax = self.roundNumber(self.sensorData['indoor-'+self.tempUnit+'-max'], temperatureDecimals).toFixed(temperatureDecimals);
		var indoorDewpointValue = self.roundNumber(self.sensorData['indoor-dewpoint-'+self.tempUnit], temperatureDecimals).toFixed(temperatureDecimals);
		var indoorHumidityValue = self.roundNumber(self.sensorData['indoor-humidity'], 0);
		
		var airPressureValue = self.roundNumber(self.sensorData['air-pressure'], temperatureDecimals).toFixed(temperatureDecimals);
		airPressureValue = self.replaceAll(airPressureValue.toString(), ".", self.config.decimalSymbol);
		var airPressureValueTrend = self.roundNumber(self.sensorData['air-pressure']-self.sensorData['air-pressure-1hour'], temperatureDecimals).toFixed(temperatureDecimals);
		var DeltaSymbol = 'right';
		if ( airPressureValueTrend > 0.1 && airPressureValueTrend < 1.0 ) {
			DeltaSymbol = 'up'
		} else if ( airPressureValueTrend >= 1.0 ) {
			DeltaSymbol = 'double-up';
		} else if ( airPressureValueTrend < -0.1 && airPressureValueTrend > -1.0 ) {
			DeltaSymbol = 'down';
		} else if ( airPressureValueTrend <= -1.0 ) {
			DeltaSymbol = 'double-down';
		}

		airPressureValueTrend = self.replaceAll(airPressureValueTrend.toString(), ".", self.config.decimalSymbol);

		var symbol = "&deg;C";
		if (self.tempUnit === "fahrenheit") { symbol = "&deg;F"; }
		else if (self.tempUnit === "kelvin") { symbol = " K"; }

		var table = document.createElement("table");
//		table.border=true;
		var tbody = document.createElement('tbody');

// outside

		var outRow1 = document.createElement('tr');
		var outRow2 = document.createElement('tr');

		var outTempSymbol = document.createElement('td');
		var outSymbolSpan = document.createElement('span');
		var outTempSymbolSpan = document.createElement('span');
		var outTempData = document.createElement('td');
		outTempData.setAttribute('colSpan', '3');
		var outTempMinSymbol = document.createElement('td');
		var outTempMin = document.createElement('td');
		var outTempMaxSymbol = document.createElement('td');
		var outTempMax = document.createElement('td');

		var outHumiSymbol = document.createElement('td');
		var outHumiSymbolSpan = document.createElement('span');
		var outHumi = document.createElement('td');
		var outDewpointSymbol = document.createElement('td');
		outDewpointSymbol.className = "smallrow";
		var outDewpoint = document.createElement('td');

		outSymbolSpan.className = "fa fa-sun";
		outTempSymbolSpan.className = "fa fa-thermometer-half smallrow";
		outTempSymbol.appendChild(outSymbolSpan);
		outTempSymbol.appendChild(outTempSymbolSpan);
		outTempData.className = "margin " + self.cssClassTemp(outdoorTemperatureValue);
		outTempData.innerHTML += outdoorTemperatureValue + symbol;
		outTempMinSymbol.className = "smallrow margin minimum fa fa-thermometer-empty";
		outTempMin.className = "smallrow margin " + self.cssClassTemp(outdoorTemperatureMin);
		outTempMin.innerHTML = outdoorTemperatureMin + symbol;
		outTempMaxSymbol.className = "smallrow margin maximum fa fa-thermometer-full";
		outTempMax.className = "smallrow margin " + self.cssClassTemp(outdoorTemperatureMax);
		outTempMax.innerHTML += outdoorTemperatureMax + symbol;
			
		outHumiSymbolSpan.className = "margin fa fa-tint smallrow";
		outHumiSymbol.appendChild(outHumiSymbolSpan);
		outHumi.innerHTML += outdoorHumidityValue + "%";
		outHumi.className = self.cssClassHumi(outdoorHumidityValue);

		outDewpoint.className = "smallrow margin";
		outDewpoint.innerHTML += outdoorDewpointValue + symbol;

		outRow1.appendChild(outTempSymbol);
		outRow1.appendChild(outTempData);
		outRow1.appendChild(outHumiSymbol);
		outRow1.appendChild(outHumi);
		outRow2.appendChild(outTempMinSymbol);
		outRow2.appendChild(outTempMin);
		outRow2.appendChild(outTempMaxSymbol);
		outRow2.appendChild(outTempMax);
		outRow2.appendChild(outDewpointSymbol);
		outRow2.appendChild(outDewpoint);

// inner

		var inRow1 = document.createElement('tr');
		var inRow2 = document.createElement('tr');
		var inTempRow = document.createElement('tr');
		var inTempRow2 = document.createElement('tr');
		var inHumiRow = document.createElement('tr');

		var inTempSymbol = document.createElement('td');
		var inTempSymbolSpan = document.createElement('span');
		var inSymbolSpan = document.createElement('span');
		var inTempData = document.createElement('td');
		inTempData.setAttribute('colSpan', '3');
		var inTempMinSymbol = document.createElement('td');
		var inTempMin = document.createElement('td');
		var inTempMaxSymbol = document.createElement('td');
		var inTempMax = document.createElement('td');

		var inHumiSymbol = document.createElement('td');
		var inHumiSymbolSpan = document.createElement('span');
		var inHumi = document.createElement('td');
		var inDewpointSymbol = document.createElement('td');
		inDewpointSymbol.className = "smallrow";
		var inDewpoint = document.createElement('td');

		inTempSymbolSpan.className = "fa fa-thermometer-half smallrow";
		inSymbolSpan.className = "fa fa-home";
		inTempSymbol.appendChild(inSymbolSpan);
		inTempSymbol.appendChild(inTempSymbolSpan);
		inTempData.className = "margin " + self.cssClassTemp(indoorTemperatureValue);
		inTempData.innerHTML += indoorTemperatureValue + symbol;
		inTempMinSymbol.className = "smallrow margin minimum fa fa-thermometer-empty";
		inTempMin.className = "smallrow margin " + self.cssClassTemp(indoorTemperatureMin);
		inTempMin.innerHTML = indoorTemperatureMin + symbol;
		inTempMaxSymbol.className = "smallrow margin maximum fa fa-thermometer-full";
		inTempMax.className = "smallrow margin " + self.cssClassTemp(indoorTemperatureMax);
		inTempMax.innerHTML += indoorTemperatureMax + symbol;
			
		inHumiSymbolSpan.className = "margin fa fa-tint smallrow";
		inHumiSymbol.appendChild(inHumiSymbolSpan);
		inHumi.innerHTML += indoorHumidityValue + "%";
		inHumi.className = self.cssClassHumi(indoorHumidityValue);

		inDewpoint.className = "smallrow margin";
		inDewpoint.innerHTML += indoorDewpointValue + symbol;

		inRow1.appendChild(inTempSymbol);
		inRow1.appendChild(inTempData);
		inRow1.appendChild(inHumiSymbol);
		inRow1.appendChild(inHumi);
		inRow2.appendChild(inTempMinSymbol);
		inRow2.appendChild(inTempMin);
		inRow2.appendChild(inTempMaxSymbol);
		inRow2.appendChild(inTempMax);
		inRow2.appendChild(inDewpointSymbol);
		inRow2.appendChild(inDewpoint);

// air pressure

		var airPressureRow = document.createElement('tr');
		var airPressureSymbol = document.createElement('td');
		var airPressure = document.createElement('td');
		var airPressureTrendSymbol = document.createElement('td');
		var airPressureTrend = document.createElement('td');
		airPressure.setAttribute('colSpan', '3');
//		airPressureSymbol.innerHTML = "<img src=images/air-pressure.png />"
		airPressure.innerHTML = airPressureValue + ' hPa';
		airPressure.className = 'medium margin ' + (airPressureValue < 1013 ? "lowpressure" : "highpressure");
		airPressureTrendSymbol.className = "margin fa fa-angle-" + DeltaSymbol;
		airPressureTrend.innerHTML = (airPressureValueTrend > 0 ? "+" : "") + airPressureValueTrend;
		airPressureTrend.className = 'medium margin ' + (airPressureValueTrend > 0 ? "highpressure" : "lowpressure");
		airPressureRow.appendChild(airPressureSymbol);
		airPressureRow.appendChild(airPressure);
		airPressureRow.appendChild(airPressureTrendSymbol);
		airPressureRow.appendChild(airPressureTrend);

		tbody.appendChild(inRow1);
		tbody.appendChild(inRow2);

		tbody.appendChild(outRow1);
		tbody.appendChild(outRow2);

		tbody.appendChild(airPressureRow);

		table.appendChild(tbody);
		wrapper.appendChild(table)

		return wrapper;
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
	if (precision >= 0) { return Number(Math.round(number + "e" + precision) + "e-" + precision); }
    	else { return Number(Math.round(number + "e-" + Math.abs(precision)) + "e" + Math.abs(precision)); }
    },

	cssClassTemp: function(val) {
		if ( val <= -10.0 ) {
			return 'fuckingcold'
		} else if ( val < 0.0 ) {
			return 'cold';
		} else if ( val < 10.0 ) {
			return 'chilly';
		} else if ( val < 20.0 ) {
			return 'comfortable';
		} else if ( val < 30.0 ) {
			return 'warm';
		} else {
			return 'hot';
		}		
	},

	cssClassHumi: function(val) {
		if ( val < 50.0 ) {
			return 'dry'
		} else if ( val < 80.0 ) {
			return 'moderate';
		} else {
			return 'wet';
		}		
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
