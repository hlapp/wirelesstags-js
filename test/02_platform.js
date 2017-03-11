"use strict";

/*
 * Test functions of the platform object
 */

describe('WirelessTagPlatform:', function() {

    var WirelessTagManager,
        WirelessTag,
        WirelessTagPlatform,
        platform;
    var tagManagers = [];
    var credentialsMissing = false;

    before('load platform module', function() {
        WirelessTagPlatform = require('../');
        WirelessTagManager = require('../lib/tagmanager');
        WirelessTag = require('../lib/tag');
        platform = WirelessTagPlatform.create();
    });

    describe('#isConnected()', function() {
        let connected;

        it('should promise connection status', function() {
            return expect(platform.isConnected()).to.eventually.be.a('boolean').
                then((status) => { connected = status });
        });
        it('should promise false initially', function() {
            return expect(connected).to.be.false;
        });
    });

    describe('#connect()', function() {
        let connectSpy = sinon.spy();

        it('should promise to connect platform to cloud API', function() {
            let connOpts = WirelessTagPlatform.loadConfig();

            if (! ((connOpts.username && connOpts.password)
                   || connOpts.bearer)) {
                // skip this if we don't have authentication information
                credentialsMissing = true;
                return this.skip();
            }

            platform.on('connect', connectSpy);
            return expect(platform.connect(connOpts)).to.
                eventually.equal(platform);
        });
        it('should emit "connect" event upon connection', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('connect', connectSpy);
            expect(connectSpy).to.have.been.calledWith(platform);
        });
        it('should make isConnected() promise true', function() {
            return expect(platform.isConnected()).to.eventually.be.true;
        });
    });

    describe('#disconnect()', function() {
        let connectSpy = sinon.spy();

        it('should promise to disconnect platform to cloud API', function() {

            platform.on('disconnect', connectSpy);
            return expect(platform.disconnect()).to.
                eventually.equal(platform);
        });
        it('should emit "disconnect" event upon connection', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('disconnect', connectSpy);
            expect(connectSpy).to.have.been.calledWith(platform);
        });
        it('should make isConnected() promise false', function() {
            return expect(platform.isConnected()).to.eventually.be.false;
        });

        after('reconnect', function() {
            let connOpts = WirelessTagPlatform.loadConfig();

            if ((connOpts.username && connOpts.password) || connOpts.bearer) {
                return platform.connect(connOpts);
            }
        });
    });

    describe('#discoverTagManagers()', function() {
        let discoverSpy = sinon.spy();

        it('should promise an array of tag managers', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.on('discover', discoverSpy);

            return expect(platform.discoverTagManagers()).
                to.eventually.satisfy((mgrs) => {
                    tagManagers = mgrs;
                    return mgrs.reduce((state, mgr) => {
                        return state && (mgr instanceof WirelessTagManager);
                    }, mgrs.length > 0);
                });
        });
        it('should emit \'discover\' event for each tag manager', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTagManager));
            expect(discoverSpy).to.have.callCount(tagManagers.length);
        });
        it('should promise the same objects when called again', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            discoverSpy.reset();

            return expect(platform.discoverTagManagers()).
                to.eventually.satisfy((mgrs) => {
                    return mgrs.reduce((state, mgr) => {
                        return state && (tagManagers.indexOf(mgr) >= 0);
                    }, mgrs.length === tagManagers.length);
                });
        });
        it('should not emit \'discover\' event again', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('discover', discoverSpy);
            return expect(discoverSpy).to.have.not.been.called;
        });
    });

    describe('#findTagManager()', function() {
        let discoverSpy = sinon.spy();
        let startTime;

        it('should promise matching tag manager', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            startTime = Date.now();
            platform.on('discover', discoverSpy);
            return expect(platform.findTagManager(tagManagers[0].mac)).
                to.eventually.equal(tagManagers[0] || "undef");
        });
        it('should use cache when object is cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(Date.now() - startTime).to.be.below(30);
        });
        it('should not emit \'discover\' when object is cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(discoverSpy).to.have.not.been.called;
        });
        it('should find matching tag manager even if not cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            discoverSpy.reset();
            platform._tagManagersByMAC.clear(); // note this is not exposed,
                                                // used to test only
            startTime = Date.now();
            let req = platform.findTagManager(tagManagers[0].mac);
            return expect(req.then((mgr) => mgr.mac)).
                to.eventually.equal(tagManagers[0].mac);
        });
        it('should use discovery API when not cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(Date.now() - startTime).to.be.above(35);
        });
        it('should emit \'discover\' event when not cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('discover', discoverSpy);
            return expect(discoverSpy).to.have.been.called.once;
        });
    });

    describe('#getTagManager()', function() {
        let discoverSpy = sinon.spy();

        it('should return matching tag manager if cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.on('discover', discoverSpy);
            let mgr = platform.getTagManager(tagManagers[0].mac);
            expect(mgr).to.be.an.instanceOf(WirelessTagManager);
            expect(mgr.mac).to.equal(tagManagers[0].mac);
        });
        it('should return the same as promised by findTagManager if cached',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               platform.on('discover', discoverSpy);
               let mgr = platform.getTagManager(tagManagers[0].mac);
               return expect(platform.findTagManager(tagManagers[0].mac)).
                   to.eventually.equal(mgr);
           });
        it('should not emit \'discover\'', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('discover', discoverSpy);
            return expect(discoverSpy).to.have.not.been.called;
        });
        it('should not find matching tag manager if not cached', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(platform.getTagManager("dummy")).to.be.undefined;
        });
    });

    describe('#eachTagManager()', function() {

        it('with no argument, should return an array of tag managers', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let mgrs = platform.eachTagManager();
            expect(mgrs).to.be.an('array');
            expect(mgrs).to.have.length.above(0);
            mgrs.forEach((m) => expect(m).to.be.an.instanceOf(WirelessTagManager));
        });
        it('with fn argument, should return an array of results from fn', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            let retVals = platform.eachTagManager((m) => m.mac);
            expect(retVals).to.be.an('array');
            expect(retVals).to.have.length.above(0);
            retVals.forEach((v) => expect(v).to.be.a('string'));
        });
    });

    describe('#discoverTags()', function() {
        let discoverSpy = sinon.spy();
        let mgrDiscoverHandler = (mgr) => { mgr.on('discover', discoverSpy) };
        let tagObjs = [];

        it('should promise an array of tags for the account', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tagManagers.forEach((mgr) => {
                let m = platform.getTagManager(mgr.mac);
                if (m) m.on('discover', discoverSpy);
            });
            platform.on('discover', mgrDiscoverHandler);
            return expect(platform.discoverTags()).
                to.eventually.satisfy((tags) => {
                    tagObjs = tags;
                    return tags.reduce((state, tag) => {
                        return state && (tag instanceof WirelessTag);
                    }, tags.length > 0);
                });
        });
        it('should emit "discover" event for each associated tag', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.removeListener('discover', mgrDiscoverHandler);
            tagManagers.forEach((mgr) => {
                let m = platform.getTagManager(mgr.mac);
                if (m) m.removeListener('discover', discoverSpy);
            });

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTag));
            expect(discoverSpy).to.have.callCount(tagObjs.length);
        });
    });

});
