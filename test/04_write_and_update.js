"use strict";

var Platform = require('../');
var tagManager;
var credentialsMissing = true;
var tags = [];

/**********************************
 * Test functions for tag objects *
 **********************************/

describe('Updating Tags:', function() {

    var focusTag;
    var tagToReset;
    var origUpdateInterval;
    var origPowerMode;
    const testInterval = 30;
    const testUpdateLoops = 2;

    before('connect to platform, find tag manager(s), find tags', function() {

        // create platform object, connection options, connect, discover
        let platform = Platform.create();
        let connOpts = Platform.loadConfig();
        if ((connOpts.username && connOpts.password) || connOpts.bearer) {
            credentialsMissing = false;
            return platform.connect(connOpts).then(
                (pf) => { return pf.discoverTagManagers() }
            ).then((managers) => {
                // we only need one tag manager for testing
                tagManager = managers[0];
                return tagManager.discoverTags();
            }).then((tagsFound) => {
                tags = tagsFound;
                // find the most out of date tag that is also a physical tag
                tagsFound = tagsFound.filter((t) => t.isPhysicalTag());
                focusTag = tagsFound[0];
                tagsFound.forEach((t) => {
                    if (t.lastUpdated() < focusTag.lastUpdated()) focusTag = t;
                });
            }).catch((e) => {
                console.error(e.stack ? e.stack : e);
                throw e;
            });
        }
    });

    after('reset tag settings if they were changed', function() {
        if (tagToReset === undefined) return;

        // allow ample time for restoration of settings
        this.timeout(60 * 1000);

        let req;
        // first restore original update interval
        if (origUpdateInterval &&
            (tagToReset.updateInterval !== origUpdateInterval)) {
            console.log("... restoring updateInterval for", tagToReset.name);
            req = tagToReset.setUpdateInterval(origUpdateInterval);
        } else {
            req = Promise.resolve(tagToReset);
        }
        // finally, restore low power mode if changed
        return req.then((tag) => {
            if (origPowerMode !== undefined) {
                console.log("... restoring low power mode for", tag.name);
                return tag.setLowPowerMode(origPowerMode);
            }
            return tag;
        }).catch((e) => {
            console.error(e.stack ? e.stack : e); throw e;
        });
    });

    describe('#setLowPowerMode(false)', function() {
        let dataSpy = sinon.spy();
        let tag;

        it("should promise tag with low power mode turned off",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tag = tagToReset = focusTag;
               origPowerMode = focusTag.lowPowerMode;

               // this call can take some time, so be generous with timeout
               this.timeout(10 * 1000);

               tag.on('data', dataSpy);
               console.log("... disabling lowPowerMode of", tag.name);
               return expect(tag.setLowPowerMode(false)).
                   to.eventually.satisfy((t) => {
                       return t.lowPowerMode === false;
                   });
           });
        it('should emit \'data\' event due to data update', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tag.removeListener('data', dataSpy);
            return expect(dataSpy).to.have.callCount(origPowerMode ? 1 : 0);
        });
    });

    describe('#setUpdateInterval()', function() {
        let dataSpy = sinon.spy();
        let tag;

        it("should be inconsequential if no change in value",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tag = focusTag;
               origUpdateInterval = focusTag.updateInterval;
               tagToReset = focusTag;

               let startTime = Date.now();
               tag.on('data', dataSpy);
               return expect(
                   tag.setUpdateInterval(tag.updateInterval).then(() => {
                       return Date.now();
                   })
               ).to.be.eventually.below(startTime + 40);
           });
        it('should then not emit \'data\' event', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(dataSpy).to.have.not.been.called;
        });
        it("should promise tag with changed 'updateInterval'",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               // this call can take some time, so be generous with timeout
               this.timeout(10 * 1000);

               dataSpy.reset();
               return expect(tag.setUpdateInterval(testInterval)).
                   to.eventually.satisfy((t) => {
                       return t.updateInterval === testInterval;
                   });
           });
        it('should emit \'data\' event due to data update', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tag.removeListener('data', dataSpy);
            return expect(dataSpy).to.have.been.calledOnce;
        });
    });

    describe('#startUpdateLoop()', function() {
        let dataSpy = sinon.spy();
        let tag;
        let dataHandler;

        it("should commence auto-update loop for tag",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tag = focusTag;

               return expect(tag.startUpdateLoop()).to.be.ok;
           });
        it("should result in data updated in regular intervals",
           function(done) {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               this.timeout(testInterval * 1000 * (testUpdateLoops + 0.5));
                                                   // allow for max 50% padding
               let lastUpdate = tag.lastUpdated();
               dataHandler = (t) => {
                   dataSpy(t, t.lastUpdated(), lastUpdate);
                   lastUpdate = t.lastUpdated();
               };
               tag.on('data', dataHandler);

               setTimeout(() => {
                   done();
               }, testInterval * 1000 * (testUpdateLoops + 0.2));

           });
        it('should emit \'data\' events about every updateInterval seconds',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               // allow between -10 to +5 seconds of update interval
               let elapsedMin = testInterval * 1000;
               if (elapsedMin > 15000) elapsedMin -= 15000;
               let elapsedMax = testInterval * 1000 + 5000;
               tag.removeListener('data', dataHandler);
               expect(dataSpy.callCount).to.be.within(testUpdateLoops,
                                                      testUpdateLoops * 2);
               // we ignore the first call here - its timing is often off
               for (let n = 1; n < dataSpy.callCount; n++) {
                   let spyCall = dataSpy.getCall(n);
                   let updatedAt = spyCall.args[1];
                   let prevUpdate = spyCall.args[2];
                   expect(updatedAt - prevUpdate).to.be.within(elapsedMin,
                                                               elapsedMax);
               }
           });
    });

    describe('#stopUpdateLoop()', function() {
        let dataSpy = sinon.spy();
        let tag;

        it("should stop auto-update loop for tag",
           function(done) {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tag = focusTag;
               tag.stopUpdateLoop();
               tag.on('data', dataSpy);

               this.timeout(testInterval * 1000 + 10000); // 10 seconds padding

               let testAndCleanup = (t) => {
                   t.removeListener('data', dataSpy);
                   try {
                       expect(dataSpy).to.have.callCount(0);
                   } finally {
                       done();
                   }
               };
               // wait for one more update cycle to test that updates stopped
               let timer = setTimeout(() => {
                   tag.removeListener('data', dataHandler);
                   testAndCleanup(tag);
               }, testInterval * 1000 + 5000); // adds 5 seconds to interval

               // fail right away if there is an update
               let dataHandler = (t) => {
                   clearTimeout(timer);
                   testAndCleanup(t);
               };
               tag.once('data', dataHandler);
           });
    });

});

/***************************************
 * Test functions of the sensor object *
 ***************************************/

describe('Updating sensors:', function() {

    var sensors;
    var sensorTags;
    var origArmed;
    var origDisarmed;
    var origPowerModes;

    before('find and distill list of sensors for testing', function() {

        this.timeout(90 * 1000);

        // enable retry if cloud times out before responds
        tagManager.wirelessTagPlatform.retryOnError(true);

        // find all the sensors of each tag
        let discoverReqs = tags.reduce((proms, tag) => {
            let sensorList = tag.eachSensor();
            if (sensorList.length > 0) {
                proms.push(Promise.resolve(sensorList));
            } else {
                proms.push(tag.discoverSensors());
            }
            return proms;
        }, []);

        // reduce the sensors list to one that contains each sensor type
        // only once, and that distributes these sensors across tags
        return Promise.all(discoverReqs).then(
            (sensorLists) => {
                // flatten out the list of sensors
                let sensorList = sensorLists.reduce((flattened, list) => {
                    // console.log("... discovered", list.length,
                    //            "sensors for", list[0].wirelessTag.toString());
                    return flattened.concat(list);
                }, []);
                // try to distribute the tested sensors across tags to
                // improve their response times
                let sensorTypeMap = sensorList.reduce((map, s) => {
                    let key = s.sensorType;
                    if (s.wirelessTag.hasAccelerometer()) key += "-accel";
                    if (map[key]) {
                        map[key].push(s);
                    } else {
                        map[key] = [s];
                    }
                    return map;
                }, {});
                let tagCounts = tags.reduce((map, t) => {
                    map[t.uuid] = 0;
                    return map;
                }, {});
                sensors = [];
                for (let k in sensorTypeMap) {
                    let s_arr = sensorTypeMap[k];
                    let s = s_arr[0];
                    for (let i = 1; i < s_arr.length; i++) {
                        if (tagCounts[s_arr[i].wirelessTag.uuid]
                            < tagCounts[s.wirelessTag.uuid]) {
                            s = s_arr[i];
                        }
                    }
                    sensors.push(s);
                    tagCounts[s.wirelessTag.uuid] += 1;
                    console.log("... scheduled", s.sensorType,
                                "of", s.wirelessTag.name, "for testing");
                }
                // compile the list of tags these sensors are from
                sensorTags = sensors.map((sensor) => {
                    return sensor.wirelessTag;
                }).reduce((arr, tag) => {
                    let i = arr.findIndex((aTag) => {
                        return aTag.uuid === tag.uuid;
                    });
                    if (i < 0) arr.push(tag);
                    return arr;
                }, []);
                // record sensor subsets by armed state
                origArmed = sensors.filter((s) => { return s.isArmed() });
                origDisarmed = sensors.filter((s) => { return !s.isArmed() });
                // disable low power mode for each tag, sequentially
                let limit = Promise.limit(1);
                origPowerModes = {};
                let proms = sensorTags.map((tag) => {
                    origPowerModes[tag.uuid] = tag.lowPowerMode;
                    return limit(() => {
                        console.log("... disabling lowPowerMode for", tag.name);
                        return tag.setLowPowerMode(false);
                    }).catch((e) => {
                        if (e instanceof Platform.RetryUnsuccessfulError) {
                            console.error(e.stack ? e.stack : e);
                            return tag;
                        }
                        throw e;
                    });
                });
                return Promise.all(proms).then((t_arr) => {
                    console.log("... done disabling lowPowerMode for",
                                t_arr.length, "tags");
                    return t_arr;
                });
            });
    });

    after('restore tags to original settings', function() {

        if (sensorTags === undefined) return;

        // this can take a while, allow ample time
        this.timeout(120 * 1000);

        let req = Promise.resolve();
        // run all operations sequentially to increase robustness
        let limit = Promise.limit(1);
        // restore sensors to original armed state
        if (origDisarmed && (origDisarmed.length > 0)) {
            req = req.then(() => {
                let proms = origDisarmed.map((s) => {
                    return limit(() => {
                        console.log("... re-disarming", s.sensorType,
                                    "of", s.wirelessTag.name);
                        return s.disarm();
                    }).catch((e) => {
                        console.error(e.stack ? e.stack : e);
                        return s;
                    });
                });
                return Promise.all(proms);
            }).then((s_arr) => {
                console.log("... done re-disarming", s_arr.length, "sensors");
                return s_arr;
            });
        }
        if (origArmed && (origArmed.length > 0)) {
            req = req.then(() => {
                let proms = origArmed.map((s) => {
                    return limit(() => {
                        console.log("... re-arming", s.sensorType,
                                    "of", s.wirelessTag.name);
                        return s.arm();
                    }).catch((e) => {
                        console.error(e.stack ? e.stack : e);
                        return s;
                    });
                });
                return Promise.all(proms);
            }).then((s_arr) => {
                console.log("... done re-arming", s_arr.length, "sensors");
                return s_arr;
            });
        }
        // finally, restore tags' low power mode if changed
        if (origPowerModes) {
            req = req.then(() => {
                let proms = sensorTags.map((tag) => {
                    return limit(() => {
                        if (origPowerModes[tag.uuid] === undefined) {
                            return Promise.resolve(tag);
                        }
                        console.log("... restoring lowPowerMode for",
                                    tag.name);
                        return tag.setLowPowerMode(origPowerModes[tag.uuid]);
                    }).catch((e) => {
                        console.error(e.stack ? e.stack : e);
                        return tag;
                    });
                });
                return Promise.all(proms);
            }).then((t_arr) => {
                for (let t of t_arr) {
                    if (t.lowPowerMode !== origPowerModes[t.uuid]) {
                        console.error("lowPowerMode not restored for",
                                      t.name);
                    }
                }
                console.log("... done restoring lowPowerMode for",
                            t_arr.length, "tags");
                // disable automatic retry again
                tagManager.wirelessTagPlatform.retryOnError(false);
                return t_arr;
            });
        }
        return req;
    });

    describe('#arm()', function() {
        it('should be rejected for sensors that don\'t support it', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = sensors.filter((s) => {
                return ! (s.canArm() || s.isArmed());
            });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            let proms = toTest.map((s) => { return s.arm() });
            // test that none of them fulfill
            return expect(Promise.any(proms)).
                to.eventually.be.rejectedWith(Promise.AggregateError);
        });
        it('should be inconsequential for sensors already armed', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = sensors.filter((s) => { return s.isArmed() });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            // to test the inconsequential nature, set timeout short enough to
            // trigger if any API call were issued
            this.timeout(40);
            // issue the arm() calls, then test
            let proms = toTest.map((s) => { return s.arm() });
            return expect(Promise.all(proms)).to.eventually.satisfy((s_arr) => {
                return s_arr.reduce((all, s) => {
                    return all && s.isArmed();
                }, true);
            });
        });

        it('should promise sensors that can arm changed to armed', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = origDisarmed.filter((s) => { return s.canArm() });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            // this can take a while, allow for sufficient time
            this.timeout(120 * 1000);
            // issue the arm() calls sequentially
            let limit = Promise.limit(1);
            let proms = toTest.map((s) => {
                return limit(() => {
                    console.log("arming", s.sensorType,
                                "of", s.wirelessTag.name,
                                "(current state: " + s.eventState + ")");
                    return s.arm();
                });
            });

            return expect(Promise.all(proms)).to.eventually.satisfy((s_arr) => {
                return s_arr.reduce((all, s) => { return all && s.isArmed() },
                                    true);
            });
        });
    });

    describe('#disarm()', function() {
        it('should be rejected for sensors that don\'t support it', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = sensors.filter((s) => {
                return s.isArmed() && !s.canDisarm();
            });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            let proms = toTest.map((s) => { return s.disarm() });
            // test that none of them fulfill
            return expect(Promise.any(proms)).
                to.eventually.be.rejectedWith(Promise.AggregateError);
        });
        it('should be inconsequential for sensors already disarmed', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = sensors.filter((s) => { return !s.isArmed() });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            // to test the inconsequential nature, set timeout short enough to
            // trigger if any API call were issued
            this.timeout(40);
            // issue the disarm() calls, then test
            let proms = toTest.map((s) => { return s.disarm() });
            return expect(Promise.all(proms)).to.eventually.satisfy((s_arr) => {
                return s_arr.reduce((all, s) => {
                    return all && !s.isArmed();
                }, true);
            });
        });
        it('should promise sensors that can disarm changed to disarmed',
           function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let toTest = origArmed.filter((s) => { return s.canDisarm() });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            // this can take a while, allow for sufficient time
            this.timeout(120 * 1000);
            // issue the disarm() calls sequentially
            let limit = Promise.limit(1);
            let proms = toTest.map((s) => {
                return limit(() => {
                    console.log("disarming", s.sensorType,
                                "of", s.wirelessTag.name,
                                "(current state: " + s.eventState + ")");
                    return s.disarm();
                });
            });

            return expect(Promise.all(proms)).to.eventually.satisfy((s_arr) => {
                return s_arr.reduce((all, s) => { return all && !s.isArmed() },
                                    true);
            });
        });
    });

    describe('#monitoringConfig().save()', function() {
        let eventSpy = sinon.spy();

        it('should have no effect if monitoring config not marked modified',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               let toTest = sensors.filter((s) => {
                   return s.wirelessTag.isPhysicalTag()
                       && s.sensorType !== 'signal';
               });
               // skip if there is nothing to test
               if (toTest.length === 0) this.skip();

               let startTime = Date.now();
               let proms = toTest.map((sensor) => {
                   sensor.on('config', eventSpy);
                   return sensor.monitoringConfig().resetModified().save();
               });
               return expect(Promise.all(proms).then(() => {
                   return Date.now();
               })).to.be.eventually.below(startTime + 50);
           });

        it('sensors should then also not trigger \'config\' event',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               return expect(eventSpy).to.have.not.been.called;
           });

        it('should promise sensor with saved monitoring config if modified',
           function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

               let toTest = sensors.filter((s) => {
                   return s.wirelessTag.isPhysicalTag()
                       && s.sensorType !== 'signal';
               });
               // skip if there is nothing to test
               if (toTest.length === 0) this.skip();

               // this can take a while, allow for sufficient time
               this.timeout(120 * 1000);
               let proms = toTest.map((s) => {
                   console.log("ensuring clean config for",
                               s.sensorType, "of", s.wirelessTag.name);
                   return s.monitoringConfig().resetModified().update();
               });
               // issue the save() calls sequentially
               let limit = Promise.limit(1);
               let saveReqs = Promise.all(proms).then(() => {
                   // reset event spy - we are not interested in update events
                   eventSpy.reset();
                   return Promise.all(toTest.map((s) => {
                       return limit(() => {
                           console.log("saving config for",
                                       s.sensorType, "of", s.wirelessTag.name);
                           return s.monitoringConfig().markModified().save();
                       });
                   }));
               });
               return expect(saveReqs).to.eventually.satisfy((mconfigs) => {
                       return mconfigs.reduce((all, c) => {
                           return all && !c.isModified();
                       }, true);
                   });
           });

        it('sensors should emit \'config\' events with sensor, config, and \'save\'',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               sensors.filter((s) => {
                   return s.wirelessTag.isPhysicalTag()
                       && s.sensorType !== 'signal';
               }).forEach((s) => {
                   return expect(eventSpy).to.have.been.calledWith(
                       s, s.monitoringConfig(), 'save'
                   );
               });
           });

    });

});
