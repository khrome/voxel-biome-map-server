var request;
var WorldBuilder = require('voxel-biomes');
var builder = new WorldBuilder();
var dbiomes = {
    'hills' : require('voxel-biomes/biomes/hills'),
    'badlands' : require('voxel-biomes/biomes/badlands'),
    'forest' : require('voxel-biomes/biomes/forest'),
    'woods' : require('voxel-biomes/biomes/woods'),
    'village' : require('voxel-biomes/biomes/village'),
    'temple' : require('voxel-biomes/biomes/temple'),
    'megalith' : require('voxel-biomes/biomes/megalith'),
    'plains' : require('voxel-biomes/biomes/plains'),
    'field' : require('voxel-biomes/biomes/field'),
    'desert' : require('voxel-biomes/biomes/desert'),
};
function getBiome(name){
    return dbiomes[name] || (dbiomes[name] = require('voxel-biomes/biomes/'+name))
}
builder.addBiome(getBiome('hills'));
builder.addBiome(getBiome('badlands'));
builder.addBiome(getBiome('forest'));
builder.addBiome(getBiome('woods'));
builder.addBiome(getBiome('village'));
builder.addBiome(getBiome('temple'));
builder.addBiome(getBiome('megalith'));
builder.addBiome(getBiome('plains'));
builder.addBiome(getBiome('field'));
builder.addBiome(getBiome('desert'));
var generator = builder.buildGenerator(WorldBuilder.Segmenters.primes());
var Reducer = require('voxel-generators/voxel-dimension-reducer');
var asynk = require('async');
var reducer = new Reducer('y');
var Canvas = require('canvas');
var fs = require('fs')
var Image = Canvas.Image;

function genericBiomeGenerator(options, callback){
    //generic biome ignores seed
    var submesh = generator.submesh(options.x, options.y, options.z);
    var chunk = submesh.generate?submesh.generate():submesh;
    setTimeout(function(){
        callback(null, chunk, submesh);
    }, 0);
}


function MapServer(options){
    this.options = options || {};
    if(this.options.url && !this.options.fetch){
        var ob = this;
        if(!request) request = require('request');
        var blocks;
        var getBlocks = function(cb){
            if(blocks) return cb(blocks);
            request({
                uri: ob.options.blocksUrl,
                json:true
            }, function(err, res, data){
                blocks = data;
                cb(blocks);
            })
        }
        this.options.fetch = function(fetchOptions, callback){
            var url = ob.options.url;
            Object.keys(fetchOptions).forEach(function(key){
                url = url.replace('{'+key+'}', fetchOptions[key]);
            });
            console.log(url);
            request({
                uri : url,
                qs : fetchOptions,
                json:true
            }, function(err, response, data){
                getBlocks(function(blocks){
                    if(err) return callback(err);
                    var biome = getBiome(data.biome);
                    if(data.chunk || data.voxels){
                        callback(null, (data.chunk || data.voxels), biome, function(bs){
                            return bs.map(function(value){
                                return blocks[value-1]?blocks[value-1][2]:null;
                            })
                        });
                    }
                })
            });
        }
    }
    if(this.options.seed && !this.options.fetch){
        var ob = this;
        this.options.fetch = function(fetchOptions, callback){
            (
                ob.options.generator || genericBiomeGenerator
            )(fetchOptions, function(err, chunk, ref){
                var fn = function(bs){
                    return bs.map(function(blockval, i){
                        if(blockval === 0) return blockval;
                        if(biome.mcmap[block+'']){
                            blockval = biome.mcmap[block+''];
                        }
                        var block = ob.pack.block(blockval).block_textures;
                        var texture = block.top || block.side;
                        return texture;
                    });
                }
                callback(err, chunk, ref.biome(), fn);
            });
        }
    }
}
MapServer.prototype.chunk = function(details, callback){
    this.options.fetch(details, callback);
}
MapServer.prototype.setTexturePack = function(pack){
    this.pack = pack;
}
MapServer.prototype.express = function(app){
    var ob = this;
    function dumpError(err, res){
        res.end({
            error : true,
            message : err.message
        })
    }

    var sliceChunk = function(x, y, z, seed, offset, callback){
        ob.chunk({
            x:x,
            y:y,
            z:z,
            seed: seed
        }, function(err, chunk, biome, transformMaterial){
            if(err) return dumpError(err, res);
            var slice = reducer.reduce(chunk, function(block, previous, index, shortCircuit){
                //if(block != 0) return shortCircuit(block);
                return previous || block;
            }, false, Array);
            callback(null, slice, biome, transformMaterial);
            console.log('generating '+biome.name, x, y, z, offset);
        });
    }
    var ts = {};
    var r;
    var getTexture = function(texture, tileSize, cb){
        if(ts[texture]) return cb(null, ts[texture]);
        fs.readFile(
            './texture-packs/freeture/assets/minecraft/textures/blocks/'+texture,
            function(err, stream){
                if(err){
                    throw err;
                }
                img = new Image;
                img.src = stream;
                var blockSize = Math.floor(tileSize/32);
                var canvas = new Canvas(blockSize, blockSize);
                var ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, blockSize , blockSize);
                if(r){
                    r.writeHead(200, {"Content-Type": "image/png"});
                    canvas.pngStream().pipe(r);
                    //process.exit();
                    return;
                }
                var img = new Image;
                img.src = canvas.toBuffer();
                ts[texture] = img;
                cb(null, img)
            }
        )
    }

    app.get('/tiles/:t/:s/:x/:y/:z/:o.png', function(req, res){
        var tileSize = 256;
        //r = res;
        sliceChunk(
            req.params.x,
            req.params.y,
            req.params.z,
            req.params.s,
            req.params.o,
            function(err, slice, biome, transformMaterial){
                if(err) return dumpError(err, res);
                if(!ob.pack) return dumpError(new Error('No TexturePack Loaded!'), res);
                var textures = transformMaterial(slice);
                var canvases = [];
                var canvas = new Canvas(tileSize, tileSize);
                var ctx = canvas.getContext('2d');
                getTexture(texture, tileSize, function(err, img){
                    asynk.eachOfSeries(textures, function(texture, index, done){
                        if(texture === null) return done();
                        if(texture === 0) return done();
                        var row = Math.floor(index / 32);
                        var col = index % 32;
                        var blockSize = Math.floor(tileSize/32);
                        getTexture(texture, tileSize, function(err, img){
                            ctx.drawImage(
                                img,
                                row * blockSize,
                                col * blockSize,
                                blockSize,
                                blockSize
                            );
                            done();
                        });
                    }, function(){
                        stream = canvas.pngStream()
                        res.writeHead(200, {"Content-Type": "image/png"});
                        canvas.pngStream().pipe(res);
                    });
                });
            }
        );
    });

    app.get('/tiles/:t/:s/:x/:y/:z/:o.chunk.json', function(req, res){
        ob.chunk({
            x:req.params.x,
            y:req.params.y,
            z:req.params.z,
            seed: req.params.s
        }, function(err, chunk, biome){
            if(err) return dumpError(err, res);
            res.end(JSON.stringify({
                chunk : chunk,
                biome : biome
            }, null, '    '));
        });
    });

    app.get('/tiles/:t/:s/:x/:y/:z/:o.json', function(req, res){
        sliceChunk(
            req.params.x,
            req.params.y,
            req.params.z,
            req.params.s,
            req.params.o,
            function(err, slice){
                if(err) return dumpError(err, res);
                res.end(JSON.stringify(slice, null, '    '))
            }
        );
    });
}

module.exports = MapServer;
