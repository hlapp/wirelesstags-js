"use strict";

var tagManager;
var credentialsMissing = true;
var tags = [];

/*
 * Test functions of the tag manager object
 */

describe('WirelessTagManager:', function() {

    var WirelessTagManager,
        WirelessTagPlatform,
        WirelessTag,
        platform;

    before('load and connect to platform, find tag manager(s)', function(done) {
        WirelessTagPlatform = require('../');
        WirelessTagManager = require('../lib/tagmanager.js');
        WirelessTag = require('../lib/tag.js');

        // create platform object, register listeners
        platform = WirelessTagPlatform.create();
        platform.on('discover', (manager) => {
            // right now we only need one tag manager for testing
            if (tagManager === undefined) tagManager = manager;
            done();
        });

        // load connection options, then connect
        let connOpts = WirelessTagPlatform.loadConfig();
        if ((connOpts.username && connOpts.password) || connOpts.bearer) {
            credentialsMissing = false;
            platform.connect(connOpts).then(
                (pf) => { pf.discoverTagManagers(); }
            ).catch((e) => { console.error(e.stack ? e.stack : e); throw e; });
        } else {
            // signal we're done - without connecting there's no discovering
            done();
        }
    });

    describe('#mac', function() {
        it('a string, its (unique) MAC address', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.mac).to.be.a('string').
                and.to.have.length.within(10,14);     // 12 in theory?
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tagManager.mac = "JX"; }).to.throw(TypeError);
        });
    });
    describe('#name', function() {
        it('a string, its (user-assigned) name', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(tagManager.name).to.be.a('string').
                and.to.not.be.empty;
        });
    });
    describe('#online', function() {
        it('a boolean, whether it is online', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.online).to.be.a('boolean');
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tagManager.online = false; }).to.throw(TypeError);
        });
    });
    describe('#selected', function() {
        it('a boolean, whether it is currently selected', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.selected).to.be.a('boolean');
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tagManager.selected = false; }).to.throw(TypeError);
        });
    });
    describe('#wirelessConfig', function() {
        it('an object, wireless communication settings', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.wirelessConfig).to.be.a('object');
        });
        it('should have at least a certain list of properties', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.wirelessConfig).to.have.all.keys(
                'dataRate',
                'activeInterval',
                'Freq',
                'useCRC16',
                'useCRC32',
                'psid');
        });
    });
    describe('#radioId', function() {
        it('a string, its (unique?) radio identity (freq band?)', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(tagManager.radioId).to.be.a('string').
                and.to.not.be.empty;
        });
        it('should convert to a float between 100-200', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            // normally these are around 150
            expect(Number(tagManager.radioId)).to.be.within(100,200);
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tagManager.radioId = 0; }).to.throw(TypeError);
        });
    });
    describe('#rev', function() {
        it('a number, should be its revision', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.rev).to.be.a('number').
                and.to.be.below(256);     // byte
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tagManager.rev = 0; }).to.throw(TypeError);
        });
    });

    describe('#select()', function() {
        it('should promise to select it for API calls - happens automatically',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();
               
               return expect(tagManager.select()).
                   to.eventually.equal(tagManager);
           });
        it('property "selected" should be true afterwards', function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();
               
               return expect(tagManager.selected).to.be.true;
        });
    });

    describe('#discoverTags()', function() {
        let discoverSpy = sinon.spy();
        
        it('should promise an array of tags associated with it', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tagManager.on('discover', discoverSpy);
            tagManager.on('discover', (tag) => {
                tags.push(tag);
            });
            return expect(tagManager.discoverTags()).
                to.eventually.satisfy((tags) => {
                    return tags.reduce((state, tag) => {
                        return state && (tag instanceof WirelessTag);
                    }, tags.length > 0);
                });
        });
        it('should emit "discover" event for each associated tag', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTag));
        });
    });

});

/*
 * Test functions of the tag object
 */

describe('WirelessTag:', function() {

    var WirelessTagSensor;

    before('load modules', function() {
        WirelessTagSensor = require('../lib/sensor.js');
    });

    describe('#uuid', function() {
        it('a string, its unique identifier as a UUID', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.uuid }).forEach((value) => {
                expect(value).to.be.a('string').and.have.lengthOf(36);
            });
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tags[0].uuid = "xzy"; }).to.throw(TypeError);
        });
    });

    describe('#name', function() {
        it('a string, its (user-assigned) name', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.name }).forEach((value) => {
                return expect(value).to.be.a('string').and.to.not.be.empty;
            });
        });
    });

    describe('#slaveId', function() {
        it("a number, its unique 8-bit number among the tag manager's tags",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tags.map((tag) => { return tag.slaveId }).forEach((value) => {
                   return expect(value).to.be.a('number').and.to.be.below(256);
               });
           });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tags[0].slaveId = -1; }).to.throw(TypeError);
        });
    });

    describe('#alive', function() {
        it('a boolean, whether it is "alive"', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.alive }).forEach((value) => {
                return expect(value).to.be.a('boolean');
            });
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tags[0].alive = false; }).to.throw(TypeError);
        });
    });

    describe('#tagType', function() {
        it('a number, an 8-bit code for its hardware type', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.tagType }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.below(256);
            });
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tags[0].tagType = 0; }).to.throw(TypeError);
        });
    });

    describe('#rev', function() {
        it('a number, an 8-bit code for its hardware revision', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.rev }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.below(256);
            });
        });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(() => { tags[0].rev = 0; }).to.throw(TypeError);
        });
    });

    describe('#updateInterval', function() {
        it('a number, interval between updates in seconds', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => {
                return tag.updateInterval;
            }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.within(10,
                                                                        7200);
            });
        });
    });

    describe('#sensorCapabilities()', function() {
        it('array of strings, sensor types the tag has', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => {
                return tag.sensorCapabilities();
            }).forEach((value) => {
                return expect(value).to.satisfy((caps) => {
                    return caps.reduce((state, cap) => {
                        return state && ('string' === typeof cap);
                    }, caps.length > 0);
                });
            });
        });
    });

    describe('#hardwareFacts()', function() {
        it('array of facts that return true for the tag', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.forEach((tag) => {
                expect(tag.hardwareFacts()).to.satisfy((feats) => {
                    return feats.reduce((state, feat) => {
                        return state
                            && ('string' === typeof feat)
                            && (tag[feat]() === true);
                    }, feats.length > 0);
                });
            });
        });
    });

    describe('#lastUpdated()', function() {
        it('a Date, time when the tag data were last updated', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => {
                return tag.lastUpdated();
            }).forEach((theDate) => {
                return expect(theDate).to.be.instanceOf(Date);
            });
        });
        it('should not be much older than the updateInterval', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.forEach((tag) => {
                expect(tag.lastUpdated().getTime()).
                    to.be.at.least(Date.now() - 1200 * tag.updateInterval);
                                                // 1000 (s -> ms) + 20%
            });
        });
    });

    describe('#discoverSensors()', function() {
        let discoverSpy = sinon.spy();
        let sensors = [];
        let numSensors = 0;
        let tag;

        it("should promise an array of the tag's sensors", function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tag = tags[0]; // choose the tag with the most sensors
            let l = tag.sensorCapabilities.length;
            for (let t of tags) {
                if (t.sensorCapabilities().length > l) {
                    tag = t;
                }
            }

            tag.on('discover', discoverSpy);
            tag.on('discover', (sensor) => {
                sensors.push(sensor);
            });
            return expect(tag.discoverSensors()).
                to.eventually.satisfy((s_arr) => {
                    numSensors = s_arr.length; // store for subsequent testing
                    return s_arr.reduce((state, sensor) => {
                        return state && (sensor instanceof WirelessTagSensor);
                    }, s_arr.length > 0);
                });
        });
        it('should emit "discover" event for each new sensor', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTagSensor));
        });
        it('initially all the tag\'s sensors are new and trigger "discover"',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               expect(discoverSpy).to.have.callCount(numSensors);
           });
        it("should promise all of tag's sensors when called again", function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            // reset the event callback spy for next test
            tag.removeAllListeners('discover');
            discoverSpy = sinon.spy();
            tag.on('discover', discoverSpy);

            return expect(tag.discoverSensors()).
                to.eventually.have.lengthOf(numSensors);
        });
        it('should not emit "discover" on sensors discovered previously',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               return expect(discoverSpy).to.not.have.been.called;
           });
    });
});

/*
 * Test functions of the sensor object
 */

describe('WirelessTagSensor:', function() {

    var sensors;

    before('find and distill list of sensors for testing', function(done) {
        // gather up a list of sensors that are all different, regardless
        // of the tag they belong to
        let proms = [];
        tags.forEach((tag) => {
            let sensorList = tag.eachSensor();
            if (sensorList.length > 0) {
                proms.push(Promise.resolve(sensorList));
            } else {
                proms.push(tag.discoverSensors());
            }
        });
        Promise.all(proms).then(
            (sensorLists) => {
                let sensorTypeMap = {};
                let sensorList = [];
                sensorLists.forEach((list) => {
                    sensorList = sensorList.concat(list);
                });
                sensors = [];
                sensorList.forEach((sensor) => {
                    let key = sensor.sensorType;
                    let tag = sensor.wirelessTag;
                    if (tag.isPhysicalTag()) key += '-phys';
                    switch (sensor.sensorType) {
                    case 'motion':
                    case 'event':
                        if (tag.hasAccelerometer()) key += "-accel";
                        if (tag.canMotionTimeout()) key += "-hmc";
                        break;
                    case 'temp':
                        if (tag.isHTU()) key += '-htu';
                        break;
                    }
                    if (!sensorTypeMap[key]) {
                        sensorTypeMap[key] = true;
                        sensors.push(sensor);
                    }
                });
                done();
            }).catch((e) => { console.error(e.stack ? e.stack : e); done(); });

    });

    describe('#reading', function() {
        let readingTypeMap = {
            'number': ['temp','humidity','moisture','light','signal','battery'],
            'string': ['event'],
            'boolean': ['water','outofrange']
        };
        let toTest;

        Object.keys(readingTypeMap).forEach(function(readingType) {
            it('should be a ' + readingType + ' for '
               + readingTypeMap[readingType] + ' sensors',
               function() {
                   // skip this if we don't have connection information
                   if (credentialsMissing) return this.skip();

                   toTest = sensors.filter((s) => {
                       return readingTypeMap[readingType].
                           indexOf(s.sensorType) >= 0;
                   });
                   // skip if there is nothing to test
                   if (toTest.length === 0) this.skip();

                   toTest.map((sensor) => {
                       return sensor.reading;
                   }).forEach((value) => {
                       expect(value).to.be.a(readingType);
                   });
               });
            it('should be read-only for these', function() {
                // skip this if we don't have connection information
                if (credentialsMissing) return this.skip();
                // skip if there is nothing to test
                if (toTest.length === 0) this.skip();

                return expect(() => {
                    toTest[0].reading = "xzy";
                }).to.throw(TypeError);
            });
        });
    });

    describe('#eventState', function() {
        let toTest;

        it('should be a string except for motion and signal sensors',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               toTest = sensors.filter((s) => {
                   return ['motion','signal'].indexOf(s.sensorType) < 0;
               });
               // skip if there is nothing to test
               if (toTest.length === 0) this.skip();

               toTest.map((sensor) => {
                   return sensor.eventState;
               }).forEach((value) => {
                   return expect(value).to.be.a('string');
               });
           });
        it('should be read-only for these', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            return expect(() => {
                toTest[0].eventState = "xzy";
            }).to.throw(TypeError);
        });
        it('should be undefined for motion and signal sensors', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            toTest = sensors.filter((s) => {
                return ['motion','signal'].indexOf(s.sensorType) >= 0;
            });
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            toTest.map((sensor) => {
                return sensor.eventState;
            }).forEach((value) => {
                return expect(value).to.be.undefined;
            });
        });
    });

    describe('#eventStateValues', function() {
        let toTest;

        it('should be list of possible values for \'eventState\'',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               toTest = sensors.filter((s) => {
                   return ['motion','signal'].indexOf(s.sensorType) < 0;
               });
               // skip if there is nothing to test
               if (toTest.length === 0) this.skip();

               toTest.map((sensor) => {
                   return [sensor.eventStateValues, sensor.eventState];
               }).forEach((value) => {
                   return expect(value[0]).to.be.an('array').
                       and.to.include(value[1]);
               });
           });
        it('should be read-only', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();
            // skip if there is nothing to test
            if (toTest.length === 0) this.skip();

            return expect(() => {
                toTest[0].eventStateValues = ["xzy"];
            }).to.throw(TypeError);
        });
    });

    describe('#isArmed()', function() {
        it('should be a boolean except for motion and signal sensors',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               let toTest = sensors.filter((s) => {
                   return s.eventState !== undefined;
               });
               // skip if there is nothing to test
               if (toTest.length === 0) this.skip();

               toTest.filter((s) => {
                   return s.eventState !== undefined;
               }).forEach((sensor) => {
                   return expect(sensor.isArmed()).to.be.a('boolean');
               });
           });
    });

});
