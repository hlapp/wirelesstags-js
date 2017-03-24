"use strict";

const waitAfter = 30 * 1000;

var Platform = require('../');
var allTags = [];
var kumostatTags = [];

/**********************************
 * Test functions for tag objects *
 **********************************/

describe('Actuate Kumostat tags:', function() {
    var focusTag;
    var thermSettings = {};
    var needRearming = false;
    var wasArmed;
    var thresholdHigh, thresholdLow;

    before('connect to platform, find Kumostat tags', function() {

        // create platform object, connection options, connect, discover
        let platform = Platform.create();
        let connOpts = Platform.loadConfig();
        if ((connOpts.username && connOpts.password) || connOpts.bearer) {
            return platform.connect(connOpts).then(
                (pf) => pf.discoverTags()
            ).then((tagsFound) => {
                allTags = tagsFound;
                kumostatTags = tagsFound.filter((t) => t.isKumostat());
                if (kumostatTags.length === 0) this.skip();
                focusTag = kumostatTags.filter(
                    (t) => t.thermostat.isACHeatOn && ! t.thermostat.isFanOn
                )[0];
                if (! focusTag) {
                    console.error('no Kumostat with AC/Heat on and Fan auto');
                    return this.skip();
                }
                thermSettings.thresholdLow = focusTag.thermostat.thresholdLow;
                thermSettings.thresholdHigh = focusTag.thermostat.thresholdHigh;
                thermSettings.tempTagUUID = focusTag.thermostat.tempTagUUID;
                if (focusTag.thermostat.tempTagUUID === focusTag.uuid) {
                    return focusTag.thermostat.tempSensor().then((sensor) => {
                        needRearming = sensor.isArmed();
                        if (sensor.isArmed()) return sensor.disarm();
                    }).then((didDisarm) => {
                        if (didDisarm) {
                            console.log('disarmed temp sensor for', focusTag.name);
                        }
                    });
                }
            }).catch((e) => {
                console.error(e.stack ? e.stack : e);
                throw e;
            });
        }
        this.skip();
    });

    after('reset tag settings if they were changed', function() {
        if (kumostatTags.length === 0) return;

        function logError(msg, err, retVal) {
            console.error(msg);
            console.error(err.stack ? err.stack : err);
            return retVal;
        }

        // allow ample time for restoration of settings
        this.timeout(60 * 1000);

        let req = Promise.resolve(focusTag);
        let th = focusTag.thermostat;
        let testSensor;
        // does temperature sensor need to be restored?
        if (th.tempTagUUID !== thermSettings.tempTagUUID) {
            req = req.then(() => th.tempSensor()).then((s) => {
                testSensor = s;
                th.tempTagUUID = thermSettings.tempTagUUID;
                console.log("restoring temp sensor");
                return th.set();
            }).catch(
                (err) => logError("failed to restore temp sensor", err)
            ).then(() => {
                if (testSensor.isArmed() && ! wasArmed) {
                    console.log("re-disarming test temp sensor");
                    return testSensor.disarm();
                } else if (wasArmed && ! testSensor.isArmed()) {
                    console.log("re-arming test temp sensor");
                    return testSensor.arm();
                }
            }).catch(
                (err) => logError("failed to re-arm/disarm test temp sensor", err)
            ).then(
                () => testSensor.monitoringConfig().resetModified().update()
            ).catch(
                (err) => console.log("updating external temp sensor config failed", err)
            ).then(() => {
                let mconf = testSensor.monitoringConfig();
                if (thresholdHigh && (thresholdHigh !== mconf.thresholds.highValue)) {
                    mconf.thresholds.highValue = thresholdHigh;
                }
                if (thresholdLow && (thresholdLow !== mconf.thresholds.lowValue)) {
                    mconf.thresholds.lowValue = thresholdLow;
                }
                if (mconf.isModified()) {
                    console.log("restoring thresholds for external temp sensor");
                }
                return mconf.save();
            }).catch(
                (err) => logError("failed to restore external temp sensor threshold", err)
            ).then(() => focusTag);
        }
        // do temperature thresholds need to be restored?
        if (th.thresholdHigh !== thermSettings.thresholdHigh
            || th.thresholdLow !== thermSettings.thresholdLow) {
            th.thresholdHigh = thermSettings.thresholdHigh;
            th.thresholdLow = thermSettings.thresholdLow;
            req = req.then(() => {
                console.log("restoring temperature thresholds");
                return th.set();
            }).catch(
                (err) => logError("failed to restore temp thresholds", err)
            ).then(() => focusTag);
        }
        // does fan need to be restored?
        if (focusTag.thermostat.isFanOn) {
            req = req.then((tag) => {
                console.log("restoring fan to 'auto'");
                return tag.turnFanOff();
            }).catch((err) => logError("failed to restore fan to 'auto'", err, focusTag));
        }
        // does AC/Heat need to be restored?
        if (! focusTag.thermostat.isACHeatOn) {
            req = req.then((tag) => {
                console.log("restoring AC/Heat to 'on'");
                return tag.turnACHeatOn();
            }).catch((err) => logError("failed to restore AC/Heat to 'on'", err, focusTag));
        }
        // was the temperature being monitored?
        if (needRearming) {
            req = req.then((tag) => tag.tempSensor()).then((sensor) => {
                console.log("rearming temp sensor for", focusTag.name);
                return sensor.arm();
            }).catch((err) => logError("failed to rearm temp sensor", err, focusTag));
        }
        return req;
    });

    describe('#turnACHeatOff()', function() {
        var tag;

        it('should succeed in switching AC/Heat off', function() {
            return expect(focusTag.turnACHeatOff()).to.eventually.satisfy((t) => {
                tag = t;
                return t.thermostat.isACHeatOn === false;
            });
        });
        it('should resolve to actuated Kumostat tag object', function() {
            expect(tag).to.equal(focusTag);
        });
        it('should not alter low/high thresholds', function() {
            expect(tag.thermostat.thresholdLow).to.equal(thermSettings.thresholdLow);
            expect(tag.thermostat.thresholdHigh).to.equal(thermSettings.thresholdHigh);
        });
        it('should not alter fan status', function() {
            expect(tag.thermostat.isFanOn).to.equal(false);
        });
        it('waiting before turning fan on ...', function(done) {
            expect(true).to.equal(true);
            this.timeout(waitAfter + 1000);
            setTimeout(done, waitAfter);
        });
    });

    describe('#turnFanOn()', function() {
        var tag;

        it('should succeed in switching fan on', function() {
            return expect(focusTag.turnFanOn()).to.eventually.satisfy((t) => {
                tag = t;
                return t.thermostat.isFanOn;
            });
        });
        it('should resolve to actuated Kumostat tag object', function() {
            expect(tag).to.equal(focusTag);
        });
        it('should not alter AC/Heat status', function() {
            expect(tag.thermostat.isACHeatOn).to.equal(false);
        });
        it('should not alter low/high thresholds', function() {
            expect(tag.thermostat.thresholdLow).to.equal(thermSettings.thresholdLow);
            expect(tag.thermostat.thresholdHigh).to.equal(thermSettings.thresholdHigh);
        });
        it('waiting before changing thermostat settings ...', function(done) {
            expect(true).to.equal(true);
            this.timeout(waitAfter + 1000);
            setTimeout(done, waitAfter);
        });
    });

    describe('#thermostat.set()', function() {

        it('should set the AC temperature thresholds', function() {
            let th = focusTag.thermostat;
            let deltaT = th.thresholdHigh - th.thresholdLow;
            th.thresholdHigh -= deltaT * 0.3;
            th.thresholdLow += deltaT * 0.3;
            return expect(th.set()).to.eventually.satisfy(
                () => (focusTag.thermostat.thresholdHigh !== thermSettings.thresholdHigh)
                    && (focusTag.thermostat.thresholdLow !== thermSettings.thresholdLow)
            );
        });
        it('should leave controlling tag unaltered if not changed', function() {
            expect(focusTag.thermostat.tempTagUUID).to.equal(thermSettings.tempTagUUID);
        });
        it('should have also turned on AC/Heat status', function() {
            expect(focusTag.thermostat.isACHeatOn).to.equal(true);
        });
        it('should change controlling sensor if temperature tag is changed', function() {
            let newTempTag = allTags.filter((t) => (t.isPhysicalTag() && t.hasTempSensor()))[0];
            if (!newTempTag) return this.skip();
            this.timeout(15000); // arming can sometimes take a while

            let th = focusTag.thermostat;
            th.tempTagUUID = newTempTag.uuid;
            return expect(th.tempSensor().then((s) => {
                wasArmed = s.isArmed();
                thresholdHigh = s.monitoringConfig().thresholds.highValue;
                thresholdLow = s.monitoringConfig().thresholds.lowValue;
                console.log("disarming temp sensor of", s.wirelessTag.name);
                return s.disarm();
            }).then(() => th.set()).then((therm) => therm.tempSensor()).then(
                (s) => s.wirelessTag.uuid
            )).to.eventually.equal(newTempTag.uuid);
        });
        it('should have armed new controlling sensor', function() {
            return expect(focusTag.thermostat.tempSensor()).
                to.eventually.satisfy((s) => s.isArmed());
        });
        it('waiting before turning AC/Heat off again ...', function(done) {
            expect(true).to.equal(true);
            this.timeout(waitAfter + 1000);
            setTimeout(done, waitAfter);
        });
        it('should succeed in switching AC/Heat off again', function() {
            return expect(focusTag.turnACHeatOff().then(
                (t) => t.thermostat.isACHeatOn)
            ).to.eventually.equal(false);
        });
        it('waiting before turning fan to \'auto\' again ...', function(done) {
            expect(true).to.equal(true);
            this.timeout(waitAfter + 1000);
            setTimeout(done, waitAfter);
        });
    });

    describe('#turnFanOff()', function() {
        var tag;
        var thLow, thHigh;

        it('should succeed in switching fan to \'auto\'', function() {
            thLow = focusTag.thermostat.thresholdLow;
            thHigh = focusTag.thermostat.thresholdHigh;

            return expect(focusTag.turnFanOff()).to.eventually.satisfy((t) => {
                tag = t;
                return t.thermostat.isFanOn === false;
            });
        });
        it('should resolve to actuated Kumostat tag object', function() {
            expect(tag).to.equal(focusTag);
        });
        it('should not alter AC/Heat status', function() {
            expect(tag.thermostat.isACHeatOn).to.equal(false);
        });
        it('should not alter low/high thresholds', function() {
            expect(tag.thermostat.thresholdLow).to.equal(thLow);
            expect(tag.thermostat.thresholdHigh).to.equal(thHigh);
        });
        it('waiting before turning AC back on', function(done) {
            expect(true).to.equal(true);
            this.timeout(2 * waitAfter + 1000);
            setTimeout(done, 2 * waitAfter);
        });
    });

    describe('#turnACHeatOn()', function() {
        var tag;
        var thLow, thHigh;

        it('should succeed in switching AC/Heat on', function() {
            thLow = focusTag.thermostat.thresholdLow;
            thHigh = focusTag.thermostat.thresholdHigh;

            return expect(focusTag.turnACHeatOn()).to.eventually.satisfy((t) => {
                tag = t;
                return t.thermostat.isACHeatOn;
            });
        });
        it('should resolve to actuated Kumostat tag object', function() {
            expect(tag).to.equal(focusTag);
        });
        it('should not alter low/high thresholds', function() {
            expect(tag.thermostat.thresholdLow).to.equal(thLow);
            expect(tag.thermostat.thresholdHigh).to.equal(thHigh);
        });
        it('waiting before restoring all settings', function(done) {
            expect(true).to.equal(true);
            this.timeout(waitAfter + 1000);
            setTimeout(done, waitAfter);
        });
    });

});
