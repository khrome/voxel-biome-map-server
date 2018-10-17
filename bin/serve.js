#!/usr/bin/env node
var app = require('express')();
var MapServer = require('../map-server');
var minecraftLoader = require('voxel-minecraft-texture-pack-loader');
var server;
(server = new MapServer({
    //seed: 'localhost'
    url: 'http://localhost:8081/chunk/alpha-google-khrome@gmail.com/{x}/{y}/{z}',
    blocksUrl: 'http://localhost:8081/assets/freeture/blocks'
})).express(app);
app.listen(3000, function(){
    minecraftLoader('./texture-packs/freeture/', function(err, pack){
        if(err) throw err;
        server.setTexturePack(pack);
        console.log('READY');
    });
});
