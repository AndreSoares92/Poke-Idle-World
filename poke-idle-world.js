// ==UserScript==
// @name         Poke Helper
// @namespace    http://tampermonkey.net/
// @version      0.92.0
// @description  Escolha os pokémons que quer caçar e ele troca automaticamente de rota.
// @author       You
// @match        https://poke.idleworld.online/play
// @run-at       document-start
// @homepage     https://github.com/AndreSoares92/Poke-Idle-World
// @icon         https://poke.idleworld.online/favicon.ico
// @updateURL    https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world.js
// @downloadURL  https://raw.githubusercontent.com/AndreSoares92/Poke-Idle-World/main/poke-idle-world.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_log
// ==/UserScript==

(function() {
    'use strict';

    // ========== CONFIG (persistida) ==========
    const KILL_TARGET    = GM_getValue('piw_killTarget', 100);
    const CAPTURE_TARGET = GM_getValue('piw_captureTarget', 1);
    let enabled          = GM_getValue('piw_enabled', true);
    let selectedPokemon  = GM_getValue('piw_selectedPokemon', []); // Array de nomes
    let huntRoutes       = []; // {slug, name, level} de todas as rotas

    // Cidades (não troca automaticamente)
    const CITY_SLUGS = new Set(['cerulean', 'pewter', 'viridian', 'cassino', 'lavender']);

    // ========== SISTEMA DE TIPOS ==========
    // Quais tipos são fracos contra cada tipo (quem é efetivo contra quem)
    const TYPE_WEAKNESS = {
        NORMAL:   ['FIGHTING'],
        FIRE:     ['WATER', 'GROUND', 'ROCK'],
        WATER:    ['GRASS', 'ELECTRIC'],
        GRASS:    ['FIRE', 'ICE', 'POISON', 'FLYING', 'BUG'],
        ELECTRIC: ['GROUND'],
        ICE:      ['FIRE', 'FIGHTING', 'ROCK', 'STEEL'],
        BUG:      ['FIRE', 'FLYING', 'ROCK'],
        POISON:   ['GROUND', 'PSYCHIC'],
        GROUND:   ['WATER', 'GRASS', 'ICE'],
        ROCK:     ['WATER', 'GRASS', 'FIGHTING', 'GROUND', 'STEEL'],
        FLYING:   ['ELECTRIC', 'ICE', 'ROCK'],
        PSYCHIC:  ['BUG', 'GHOST', 'DARK'],
        GHOST:    ['GHOST', 'DARK'],
        DRAGON:   ['ICE', 'DRAGON', 'FAIRY'],
        DARK:     ['FIGHTING', 'BUG', 'FAIRY'],
        STEEL:    ['FIRE', 'FIGHTING', 'GROUND'],
        FAIRY:    ['POISON', 'STEEL'],
        FIGHTING: ['FLYING', 'PSYCHIC', 'FAIRY'],
    };

    // Quais tipos são FORTE contra cada tipo (quem o tipo é efetivo contra)
    const TYPE_SUPER_EFFECTIVE = {
        NORMAL:   [],
        FIRE:     ['GRASS', 'ICE', 'BUG', 'STEEL'],
        WATER:    ['FIRE', 'GROUND', 'ROCK'],
        GRASS:    ['WATER', 'GROUND', 'ROCK'],
        ELECTRIC: ['WATER', 'FLYING'],
        ICE:      ['GRASS', 'GROUND', 'FLYING', 'DRAGON'],
        BUG:      ['GRASS', 'PSYCHIC', 'DARK'],
        POISON:   ['GRASS', 'FAIRY'],
        GROUND:   ['FIRE', 'ELECTRIC', 'POISON', 'ROCK', 'STEEL'],
        ROCK:     ['FIRE', 'ICE', 'BUG', 'FLYING'],
        FLYING:   ['GRASS', 'BUG', 'FIGHTING'],
        PSYCHIC:  ['FIGHTING', 'POISON'],
        GHOST:    ['PSYCHIC', 'GHOST'],
        DRAGON:   ['DRAGON'],
        DARK:     ['PSYCHIC', 'GHOST'],
        STEEL:    ['ICE', 'ROCK', 'FAIRY'],
        FAIRY:    ['FIGHTING', 'DRAGON', 'DARK'],
        FIGHTING: ['NORMAL', 'ICE', 'ROCK', 'DARK', 'STEEL'],
    };

    const TYPE_WEAK_TO = {
        NORMAL:   ['FIGHTING'],
        FIRE:     ['WATER', 'GROUND', 'ROCK'],
        WATER:    ['GRASS', 'ELECTRIC'],
        GRASS:    ['FIRE', 'ICE', 'POISON', 'FLYING', 'BUG'],
        ELECTRIC: ['GROUND'],
        ICE:      ['FIRE', 'FIGHTING', 'ROCK', 'STEEL'],
        FIGHTING: ['FLYING', 'PSYCHIC', 'FAIRY'],
        POISON:   ['GROUND', 'PSYCHIC'],
        GROUND:   ['WATER', 'GRASS', 'ICE'],
        FLYING:   ['ELECTRIC', 'ICE', 'ROCK'],
        PSYCHIC:  ['BUG', 'GHOST', 'DARK'],
        BUG:      ['FIRE', 'FLYING', 'ROCK'],
        ROCK:     ['WATER', 'GRASS', 'FIGHTING', 'GROUND', 'STEEL'],
        GHOST:    ['GHOST', 'DARK'],
        DRAGON:   ['ICE', 'DRAGON', 'FAIRY'],
        DARK:     ['FIGHTING', 'BUG', 'FAIRY'],
        STEEL:    ['FIRE', 'FIGHTING', 'GROUND'],
        FAIRY:    ['POISON', 'STEEL'],
    };

    const TYPE_COLORS = {
        NORMAL: '#a8a878', FIRE: '#f08030', WATER: '#6890f0', GRASS: '#78c850',
        ELECTRIC: '#f8d030', ICE: '#98d8d8', BUG: '#a8b820', POISON: '#a040a0',
        GROUND: '#e0c068', ROCK: '#b8a038', FLYING: '#a890f0', PSYCHIC: '#f85888',
        GHOST: '#705898', DRAGON: '#7038f8', DARK: '#705848', STEEL: '#b8b8d0',
        FAIRY: '#ee99ac', FIGHTING: '#c03028',
    };

    // Retorna os tipos que são fracos contra os tipos do pokémon líder
    function getWeakTypesAgainstLeader(leaderTypes) {
        const weakTypes = new Set();
        for (const type of leaderTypes) {
            const effective = TYPE_SUPER_EFFECTIVE[type] || [];
            effective.forEach(t => weakTypes.add(t));
        }
        return [...weakTypes];
    }

    // Verifica se um pokémon é fraco contra o líder
    function isWeakAgainstLeader(pokemonName, leaderTypes) {
        if (!leaderTypes || leaderTypes.length === 0) return true; // Se não tem líder, mostra todos
        const creature = creatures.find(c => c.name?.toLowerCase() === pokemonName.toLowerCase());
        if (!creature) return true; // Se não encontrou o creature, mostra por precaução
        const pokeTypes = [creature.type1, creature.type2].filter(Boolean);
        const weakTypes = getWeakTypesAgainstLeader(leaderTypes);
        // O pokémon é fraco se qualquer um dos seus tipos é fraco contra o líder
        return pokeTypes.some(t => weakTypes.includes(t));
    }

    // Tabela fixa dos pokémons que têm versão shiny no jogo (64 espécies)
    const SHINY_SPECIES_IDS = new Set([
        3, 6, 9, 12, 15, 18, 19, 20, 22, 26, 34, 41, 43, 45,
        46, 47, 48, 49, 58, 59, 63, 65, 68, 72, 73, 76, 82, 83,
        88, 89, 94, 95, 97, 98, 99, 100, 101, 104, 105, 106, 107, 114,
        116, 117, 122, 123, 124, 125, 126, 127, 128, 129, 130, 132, 134, 135,
        136, 143, 147, 148, 157, 178, 181, 247
    ]);

    // ========== DADOS DO IV HELPER ==========
    const BASE_STATS_TABLE = {
        1:[45,49,49,65,65,45], 2:[60,62,63,80,80,60], 3:[80,82,83,100,100,80], 4:[39,52,43,60,50,65], 5:[58,64,58,80,65,80],
        6:[78,84,78,109,85,100], 7:[44,48,65,50,64,43], 8:[59,63,80,65,80,58], 9:[79,83,100,85,105,78], 10:[45,30,35,20,20,45],
        11:[50,20,55,25,25,30], 12:[60,45,50,90,80,70], 13:[40,35,30,20,20,50], 14:[45,25,50,25,25,35], 15:[65,90,40,45,80,75],
        16:[40,45,40,35,35,56], 17:[63,60,55,50,50,71], 18:[83,80,75,70,70,101], 19:[30,56,35,25,35,72], 20:[55,81,60,50,70,97],
        21:[40,60,30,31,31,70], 22:[65,90,65,61,61,100], 23:[35,60,44,40,54,55], 24:[60,95,69,65,79,80], 25:[35,55,40,50,50,90],
        26:[60,90,55,90,80,110], 27:[50,75,85,20,30,40], 28:[75,100,110,45,55,65], 29:[55,47,52,40,40,41], 30:[70,62,67,55,55,56],
        31:[90,92,87,75,85,76], 32:[46,57,40,40,40,50], 33:[61,72,57,55,55,65], 34:[81,102,77,85,75,85], 35:[70,45,48,60,65,35],
        36:[95,70,73,95,90,60], 37:[38,41,40,50,65,65], 38:[73,76,75,81,100,100], 39:[115,45,20,45,25,20], 40:[140,70,45,85,50,45],
        41:[40,45,35,30,40,55], 42:[75,80,70,65,75,90], 43:[45,50,55,75,65,30], 44:[60,65,70,85,75,40], 45:[75,80,85,110,90,50],
        46:[35,70,55,45,55,25], 47:[60,95,80,60,80,30], 48:[60,55,50,40,55,45], 49:[70,65,60,90,75,90], 50:[10,55,25,35,45,95],
        51:[35,100,50,50,70,120], 52:[40,45,35,40,40,90], 53:[65,70,60,65,65,115], 54:[50,52,48,65,50,55], 55:[80,82,78,95,80,85],
        56:[40,80,35,35,45,70], 57:[65,105,60,60,70,95], 58:[55,70,45,70,50,60], 59:[90,110,80,100,80,95], 60:[40,50,40,40,40,90],
        61:[65,65,65,50,50,90], 62:[90,95,95,70,90,70], 63:[25,20,15,105,55,90], 64:[40,35,30,120,70,105], 65:[55,50,45,135,95,120],
        66:[70,80,50,35,35,35], 67:[80,100,70,50,60,45], 68:[90,130,80,65,85,55], 69:[50,75,35,70,30,40], 70:[65,90,50,85,45,55],
        71:[80,105,65,100,70,70], 72:[40,40,35,50,100,70], 73:[80,70,65,80,120,100], 74:[40,80,100,30,30,20], 75:[55,95,115,45,45,35],
        76:[80,120,130,55,65,45], 77:[50,85,55,65,65,90], 78:[65,100,70,80,80,105], 79:[90,65,65,40,40,15], 80:[95,75,110,100,80,30],
        81:[25,35,70,95,55,45], 82:[50,60,95,120,70,70], 83:[52,90,55,58,62,60], 84:[35,85,45,35,35,75], 85:[60,110,70,60,60,110],
        86:[65,45,55,45,70,45], 87:[90,70,80,70,95,70], 88:[80,80,50,40,50,25], 89:[105,105,75,65,100,50], 90:[30,65,100,45,25,40],
        91:[50,95,180,85,45,70], 92:[30,35,30,100,35,80], 93:[45,50,45,115,55,95], 94:[60,65,60,130,75,110], 95:[35,45,160,30,45,70],
        96:[60,48,45,43,90,42], 97:[85,73,70,73,115,67], 98:[30,105,90,25,25,50], 99:[55,130,115,50,50,75], 100:[40,30,50,55,55,100],
        101:[60,50,70,80,80,150], 102:[60,40,80,60,45,40], 103:[95,95,85,125,75,55], 104:[50,50,95,40,50,35], 105:[60,80,110,50,80,45],
        106:[50,120,53,35,110,87], 107:[50,105,79,35,110,76], 108:[90,55,75,60,75,30], 109:[40,65,95,60,45,35], 110:[65,90,120,85,70,60],
        111:[80,85,95,30,30,25], 112:[105,130,120,45,45,40], 113:[250,5,5,35,105,50], 114:[65,55,115,100,40,60], 115:[105,95,80,40,80,90],
        116:[30,40,70,70,25,60], 117:[55,65,95,95,45,85], 118:[45,67,60,35,50,63], 119:[80,92,65,65,80,68], 120:[30,45,55,70,55,85],
        121:[60,75,85,100,85,115], 122:[40,45,65,100,120,90], 123:[70,110,80,55,80,105], 124:[65,50,35,115,95,95], 125:[65,83,57,95,85,105],
        126:[65,95,57,100,85,93], 127:[65,125,100,55,70,85], 128:[75,100,95,40,70,110], 129:[20,10,55,15,20,80], 130:[95,125,79,60,100,81],
        131:[130,85,80,85,95,60], 132:[48,48,48,48,48,48], 133:[55,55,50,45,65,55], 134:[130,65,60,110,95,65], 135:[65,65,60,110,95,130],
        136:[65,130,60,95,110,65], 137:[65,60,70,85,75,40], 138:[35,40,100,90,55,35], 139:[70,60,125,115,70,55], 140:[30,80,90,55,45,55],
        141:[60,115,105,65,70,80], 142:[80,105,65,60,75,130], 143:[160,110,65,65,110,30], 144:[90,85,100,95,125,85], 145:[90,90,85,125,90,100],
        146:[90,100,90,125,85,90], 147:[41,64,45,50,50,50], 148:[61,84,65,70,70,70], 149:[91,134,95,100,100,80], 150:[106,110,90,154,90,130],
        151:[100,100,100,100,100,100], 152:[45,49,65,49,65,45], 153:[60,62,80,63,80,60], 154:[80,82,100,83,100,80], 155:[39,52,43,60,50,65],
        156:[58,64,58,80,65,80], 157:[78,84,78,109,85,100], 158:[50,65,64,44,48,43], 159:[65,80,80,59,63,58], 160:[85,105,100,79,83,78],
        161:[35,46,34,35,45,20], 162:[85,76,64,45,55,90], 163:[60,30,30,36,56,50], 164:[100,50,50,86,96,70], 165:[40,20,30,40,80,55],
        166:[55,35,50,55,110,85], 167:[40,60,40,40,40,30], 168:[70,90,70,60,70,40], 169:[85,90,80,70,80,130], 170:[75,38,38,56,56,67],
        171:[125,58,58,76,76,67], 172:[20,40,15,35,35,60], 173:[50,25,28,45,55,15], 174:[90,30,15,40,20,15], 175:[35,20,65,40,65,20],
        176:[55,40,85,80,105,40], 177:[40,50,45,70,45,70], 178:[65,75,70,95,70,95], 179:[55,40,40,65,45,35], 180:[70,55,55,80,60,45],
        181:[90,75,85,115,90,55], 182:[75,80,95,90,100,50], 183:[70,20,50,20,50,40], 184:[100,50,80,60,80,50], 185:[70,100,115,30,65,30],
        186:[90,75,75,90,100,70], 187:[35,35,40,35,55,50], 188:[55,45,50,45,65,80], 189:[75,55,70,55,95,110], 190:[55,70,55,40,55,85],
        191:[30,30,30,30,30,30], 192:[75,75,55,105,85,30], 193:[65,65,45,75,45,95], 194:[55,45,45,25,25,15], 195:[95,85,85,65,65,35],
        196:[65,65,60,130,95,110], 197:[95,65,110,60,130,65], 198:[60,85,42,85,42,91], 199:[95,75,80,100,110,30], 200:[60,60,60,85,85,85],
        201:[48,72,48,72,48,48], 202:[190,33,58,33,58,33], 203:[70,80,65,90,65,85], 204:[50,65,90,35,35,15], 205:[75,90,140,60,60,40],
        206:[100,70,70,65,65,45], 207:[65,75,105,35,65,85], 208:[75,85,200,55,65,30], 209:[60,80,50,40,40,30], 210:[90,120,75,60,60,45],
        211:[65,95,85,55,55,85], 212:[70,130,100,55,80,65], 213:[20,10,230,10,230,5], 214:[80,125,75,40,95,85], 215:[55,95,55,35,75,115],
        216:[60,80,50,50,50,40], 217:[90,130,75,75,75,55], 218:[40,40,40,70,40,20], 219:[60,50,120,90,80,30], 220:[50,50,40,30,30,50],
        221:[100,100,80,60,60,50], 222:[65,55,95,65,95,35], 223:[35,65,35,65,35,65], 224:[75,105,75,105,75,45], 225:[45,55,45,65,45,75],
        226:[85,40,70,80,140,70], 227:[65,80,140,40,70,70], 228:[45,60,30,80,50,65], 229:[75,90,50,110,80,95], 230:[75,95,95,95,95,85],
        231:[90,60,60,40,40,40], 232:[90,120,120,60,60,50], 233:[85,80,90,105,95,60], 234:[73,95,62,85,65,85], 235:[55,20,35,20,45,75],
        236:[35,35,35,35,35,35], 237:[50,95,95,35,110,70], 238:[45,30,15,85,65,65], 239:[45,63,37,65,55,95], 240:[45,75,37,70,55,83],
        241:[95,80,105,40,70,100], 242:[255,10,10,75,135,55], 243:[90,85,75,115,100,115], 244:[115,115,85,90,75,100], 245:[100,75,115,90,115,85],
        246:[50,64,50,45,50,41], 247:[70,84,70,65,70,51], 248:[100,134,110,95,100,61], 249:[106,90,130,90,154,110], 250:[106,130,90,110,154,90],
        251:[100,100,100,100,100,100]
    };

    const STAT_KEYS = ["hp","atk","def","spAtk","spDef","speed"];
    const STAT_LABELS = {hp:"HP",atk:"Atk",def:"Def",spAtk:"SpA",spDef:"SpD",speed:"Spe"};
    const STAT_COLORS = {hp:"#7ac74c",atk:"#f08030",def:"#f8d030",spAtk:"#6890f0",spDef:"#78c8b0",speed:"#f85888"};

    const TYPE_CHART_FULL = {
        normal:{rock:.5,ghost:0,steel:.5},
        fire:{fire:.5,water:.5,grass:2,ice:2,bug:2,rock:.5,dragon:.5,steel:2},
        water:{fire:2,water:.5,grass:.5,ground:2,rock:2,dragon:.5},
        electric:{water:2,electric:.5,grass:.5,ground:0,flying:2,dragon:.5},
        grass:{fire:.5,water:2,grass:.5,poison:.5,ground:2,flying:.5,bug:.5,rock:2,dragon:.5,steel:.5},
        ice:{fire:.5,water:.5,grass:2,ice:.5,ground:2,flying:2,dragon:2,steel:.5},
        fighting:{normal:2,ice:2,poison:.5,flying:.5,psychic:.5,bug:.5,rock:2,ghost:0,dark:2,steel:2,fairy:.5},
        poison:{grass:2,poison:.5,ground:.5,rock:.5,ghost:.5,steel:0,fairy:2},
        ground:{fire:2,electric:2,grass:.5,poison:2,flying:0,bug:.5,rock:2,steel:2},
        flying:{electric:.5,grass:2,fighting:2,bug:2,rock:.5,steel:.5},
        psychic:{fighting:2,poison:2,psychic:.5,dark:0,steel:.5},
        bug:{fire:.5,grass:2,fighting:.5,poison:.5,flying:.5,psychic:2,ghost:.5,dark:2,steel:.5,fairy:.5},
        rock:{fire:2,ice:2,fighting:.5,ground:.5,flying:2,bug:2,steel:.5},
        ghost:{normal:0,psychic:2,ghost:2,dark:.5},
        dragon:{dragon:2,steel:.5,fairy:0},
        dark:{fighting:.5,psychic:2,ghost:2,dark:.5,fairy:.5},
        steel:{fire:.5,water:.5,electric:.5,ice:2,rock:2,steel:.5,fairy:2},
        fairy:{fire:.5,fighting:2,poison:.5,dragon:2,dark:2,steel:.5}
    };

    const TYPE_COLORS_MAP = {
        normal:"#a8a878",fire:"#f08030",water:"#6890f0",electric:"#f8d030",grass:"#78c850",
        ice:"#98d8d8",fighting:"#c03028",poison:"#a040a0",ground:"#e0c068",flying:"#a890f0",
        psychic:"#f85888",bug:"#a8b820",rock:"#b8a038",ghost:"#705898",dragon:"#7038f8",
        dark:"#705848",steel:"#b8b8d0",fairy:"#ee99ac"
    };

    const TYPE_PT_MAP = {
        normal:"Normal",fire:"Fogo",water:"Água",electric:"Elétrico",grass:"Planta",
        ice:"Gelo",fighting:"Lutador",poison:"Veneno",ground:"Terra",flying:"Voador",
        psychic:"Psíquico",bug:"Inseto",rock:"Pedra",ghost:"Fantasma",dragon:"Dragão",
        dark:"Sombrio",steel:"Aço",fairy:"Fada"
    };

    const CLANS_MAP = {
        ironhard:{name:"Ironhard",types:["steel"],color:"#b8b8d0"},
        naturia:{name:"Naturia",types:["grass","bug"],color:"#78c850"},
        seavell:{name:"Seavell",types:["water","ice"],color:"#6890f0"},
        malefic:{name:"Malefic",types:["ghost","dark","poison"],color:"#705898"},
        orebound:{name:"Orebound",types:["rock","ground"],color:"#b8a038"},
        psycraft:{name:"Psycraft",types:["psychic","fairy"],color:"#f85888"},
        raibolt:{name:"Raibolt",types:["electric"],color:"#f8d030"},
        volcanic:{name:"Volcanic",types:["fire"],color:"#f08030"},
        gardestrike:{name:"Gardestrike",types:["fighting","normal"],color:"#c03028"},
        wingeon:{name:"Wingeon",types:["flying","dragon"],color:"#a890f0"}
    };

    const QUALITY_EXP = {hp:.95,atk:.8,def:.8,spAtk:.8,spDef:.8,speed:.95};

    const QUALITY_TIERS = [
        {min:3,name:"Divina",color:"#DBEFFF"},
        {min:2.6,name:"Antiga",color:"#B8860B"},
        {min:1.8,name:"Mítica",color:"#6A0DAD"},
        {min:1.7,name:"Lendária",color:"#FF8C3C"},
        {min:1.5,name:"Épica",color:"#F0C040"},
        {min:1.3,name:"Rara",color:"#B06CFF"},
        {min:1.1,name:"Incomum",color:"#7FD4FF"},
        {min:1,name:"Comum",color:"#63D873"},
        {min:-Infinity,name:"Fraca",color:"#9AA6B3"}
    ];

    function getBaseStatsForSpecies(speciesId) {
        const table = BASE_STATS_TABLE[Number(speciesId)];
        if (!table) return null;
        return { hp: table[0], atk: table[1], def: table[2], spAtk: table[3], spDef: table[4], speed: table[5] };
    }

    function calculateStatFormula(base, iv, level, qualPow) {
        return Math.max(1, Math.round((base + 2 * iv) * level / 100 * qualPow));
    }

    function computeExactIVs(pokemon) {
        const quality = Number(pokemon.quality);
        const baseStats = getBaseStatsForSpecies(pokemon.speciesId || pokemon.pokeId);
        if (!baseStats || !Number.isFinite(quality) || quality <= 0) return null;

        const level = Number(pokemon.level);
        const statsObj = pokemon.stats;
        if (!statsObj || !Number.isFinite(level) || level <= 0) return null;

        const result = {};
        for (const key of STAT_KEYS) {
            const qualPow = Math.pow(quality, QUALITY_EXP[key]);
            const currentVal = Number(statsObj[key]);
            let candidates = [];
            let minDiff = Infinity;

            if (Number.isFinite(currentVal)) {
                for (let iv = 0; iv <= 32; iv++) {
                    const diff = Math.abs(calculateStatFormula(baseStats[key], iv, level, qualPow) - currentVal);
                    if (diff < minDiff) {
                        minDiff = diff;
                        candidates = [iv];
                    } else if (diff === minDiff) {
                        candidates.push(iv);
                    }
                }
            }
            if (candidates.length === 0) candidates = [0];
            result[key] = { min: candidates[0], max: candidates[candidates.length - 1] };
        }

        const ivTotal = Number(pokemon.ivTotal);
        if (Number.isFinite(ivTotal)) {
            for (let pass = 0; pass < 6; pass++) {
                let changed = false;
                for (const key of STAT_KEYS) {
                    let otherMin = 0, otherMax = 0;
                    for (const k of STAT_KEYS) {
                        if (k !== key) {
                            otherMin += result[k].min;
                            otherMax += result[k].max;
                        }
                    }
                    const newMin = Math.max(result[key].min, ivTotal - otherMax);
                    const newMax = Math.min(result[key].max, ivTotal - otherMin);
                    if (newMin > newMax) break;
                    if (newMin !== result[key].min || newMax !== result[key].max) {
                        result[key] = { min: newMin, max: newMax };
                        changed = true;
                    }
                }
                if (!changed) break;
            }
        }
        return result;
    }

    function getQualityTier(qualityNum) {
        const q = Number(qualityNum);
        if (!Number.isFinite(q)) return null;
        for (const tier of QUALITY_TIERS) {
            if (tier.min >= 1.8 ? q > tier.min : q >= tier.min) return tier;
        }
        return QUALITY_TIERS[QUALITY_TIERS.length - 1];
    }

    function getClanForPokemon(pokeTypes, myClanSlug) {
        if (!pokeTypes || pokeTypes.length === 0) return '';
        const typesLower = pokeTypes.map(t => String(t).toLowerCase());
        const matchingClans = Object.entries(CLANS_MAP).filter(([slug, clan]) =>
            clan.types.some(t => typesLower.includes(t))
        ).map(([slug, clan]) => ({ slug, ...clan }));

        if (matchingClans.length === 0) return '';
        const myRank = GM_getValue('piw_clanRank', 1);
        const rankPct = 6 * Math.min(5, Math.max(1, Number(myRank) || 1));

        return matchingClans.map(c => {
            const isMine = myClanSlug && c.slug === myClanSlug;
            return `<span class="piw-iw-chip" style="border-color:${c.color}99;background:${c.color}33" title="Clã ${c.name}">🛡 ${c.name}${isMine ? ` <b style="color:#9fe08a">✓ +${rankPct}%</b>` : ''}</span>`;
        }).join('');
    }

    function calculateMatchupsHtml(pokeTypes) {
        if (!pokeTypes || pokeTypes.length === 0) return "";
        const typesLower = pokeTypes.map(t => String(t).toLowerCase()).filter(t => t in TYPE_CHART_FULL);
        if (typesLower.length === 0) return "";

        const allTypes = Object.keys(TYPE_CHART_FULL);
        const superEffectiveGiven = [];
        const superEffectiveTaken = { 2: [], 4: [], 0: [] };

        for (const targetType of allTypes) {
            let mult = 1;
            for (const pType of typesLower) {
                const chart = TYPE_CHART_FULL[pType] || {};
                mult *= (chart[targetType] ?? 1);
            }
            if (mult >= 2) superEffectiveGiven.push(targetType);
        }

        for (const attackerType of allTypes) {
            const chart = TYPE_CHART_FULL[attackerType] || {};
            let mult = 1;
            for (const pType of typesLower) {
                mult *= (chart[pType] ?? 1);
            }
            if (mult === 2) superEffectiveTaken[2].push(attackerType);
            else if (mult >= 4) superEffectiveTaken[4].push(attackerType);
            else if (mult === 0) superEffectiveTaken[0].push(attackerType);
        }

        const renderRow = (icon, label, typeList, color) => {
            if (!typeList || typeList.length === 0) return "";
            const badges = typeList.map(t => {
                const bg = TYPE_COLORS_MAP[t] || '#888';
                const ptName = TYPE_PT_MAP[t] || t;
                return `<span class="piw-iw-type" style="background:${bg}">${ptName}</span>`;
            }).join(' ');
            return `<div class="piw-iw-eff-row"><span class="piw-iw-eff-label" style="color:${color}">${icon} ${label}</span>${badges}</div>`;
        };

        return `
            ${renderRow("⚔", "Dá 2x+", superEffectiveGiven, "#9fe08a")}
            ${renderRow("🛡", "Toma 4x", superEffectiveTaken[4], "#ff6b6b")}
            ${renderRow("🛡", "Toma 2x", superEffectiveTaken[2], "#ffb04a")}
            ${renderRow("🛡", "Imune", superEffectiveTaken[0], "#9fb0ff")}
        `;
    }

    function getPokemonSpriteUrls(speciesId, isShiny) {
        const id = Number(speciesId);
        if (!Number.isFinite(id) || id <= 0) return null;
        const shinyPath = isShiny ? 'shiny/' : '';
        const base = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
        return {
            anim: `${base}/versions/generation-v/black-white/animated/${shinyPath}${id}.gif`,
            still: `${base}/${shinyPath}${id}.png`
        };
    }

    function getLeaderStatsFromDOM() {
        const activeMon = document.querySelector(".phud-party .phud-mon.active, .phud-party .phud-mon");
        if (!activeMon) return null;
        const name = activeMon.querySelector(".phud-name")?.textContent?.trim() || "";
        const lvMatch = (activeMon.querySelector(".phud-lv")?.textContent || "").match(/\d+/);
        const level = lvMatch ? Number(lvMatch[0]) : null;

        const hpTxt = activeMon.querySelector(".sbar-hp .sbar-txt")?.textContent?.trim() || "";
        const hpParts = hpTxt.split('/').map(v => Number(v.replace(/\D/g, '')));
        const hpCurrent = hpParts[0];
        const hpMax = hpParts[1];

        const expTxt = activeMon.querySelector(".sbar-exp .sbar-txt")?.textContent?.trim() || "";
        const expMatch = expTxt.match(/(\d+(?:\.\d+)?)\s*%/);
        const expPct = expMatch ? parseFloat(expMatch[1]) : null;

        return { name, level, hpCurrent, hpMax, expPct };
    }

    // Estado do líder e janela flutuante
    let currentLeaderData = null;
    let infoWindowVisible = GM_getValue('piw_info_win_visible', false);

    let leaderName = '';
    let leaderTypes = [];
    let leaderPokeId = 0;
    let leaderLevel = 0;
    let filterWeakOnly = GM_getValue('piw_filterWeakOnly', false);
    let currentPage = 1;
    const ITEMS_PER_PAGE = 25;
    let shinyOnlyMode = GM_getValue('piw_shinyOnly', false);
    let shinyCount = 0;
    let lastPokesList = []; // Lista anterior de pokémons pra detectar novos shinies
    let ownedShinies = new Set(); // Removido - não precisa mais
    let shinyAvailable = new Set(); // Nomes dos pokémons que têm versão shiny no jogo
    let filterShinyAvail = GM_getValue('piw_filterShinyAvail', false);
    let loopMode = GM_getValue('piw_loopMode', false);
    let exitOnKills = GM_getValue('piw_exitOnKills', false);
    let exitOnCaptures = GM_getValue('piw_exitOnCaptures', false);

    // ========== STATE ==========
    let killCount      = GM_getValue('piw_killCount', 0);
    let captureCount   = GM_getValue('piw_captureCount', 0);
    let currentRoute   = GM_getValue('piw_currentRoute', '');
    let currentSlug    = GM_getValue('piw_currentSlug', '');
    let huntingPokemon = GM_getValue('piw_huntingPokemon', ''); // Pokémons sendo caçado atualmente
    let busy           = false;
    let socket         = null;
    let creatures      = []; // Todos os pokémons do creatures.json
    let routes         = []; // Todas as rotas do mapa

    function saveState() {
        GM_setValue('piw_killCount', killCount);
        GM_setValue('piw_captureCount', captureCount);
        GM_setValue('piw_currentRoute', currentRoute);
        GM_setValue('piw_currentSlug', currentSlug);
        GM_setValue('piw_huntingPokemon', huntingPokemon);
    }

    // ========== STYLES ==========
    GM_addStyle(`
.piw-panel {
    position: fixed; bottom: 76px; right: 10px; z-index: 2147483000;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 13px; line-height: 1.4;
    width: 340px; min-width: 340px; min-height: 200px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    max-height: 90vh; overflow: hidden;
    display: flex; flex-direction: column;
}
.piw-panel-inner {
    padding: 14px; overflow-y: auto; flex: 1 1 auto; min-height: 0; margin-bottom: 12px;
    scrollbar-width: thin; scrollbar-color: rgba(132,144,255,.4) rgba(255,255,255,.05);
}
.piw-panel-inner::-webkit-scrollbar { width: 6px; }
.piw-panel-inner::-webkit-scrollbar-track { background: rgba(255,255,255,.04); border-radius: 99px; }
.piw-panel-inner::-webkit-scrollbar-thumb { background: rgba(132,144,255,.38); border-radius: 99px; }
.piw-panel-inner::-webkit-scrollbar-thumb:hover { background: rgba(132,144,255,.65); }
.piw-panel { padding-top: 0 !important; }
.piw-panel h3 {
    margin: 0 0 8px; padding: 10px 14px; font-size: 14px; color: #fff; font-weight: 700;
    letter-spacing: .4px; cursor: move; display: flex; justify-content: space-between;
    align-items: center; user-select: none;
    background: linear-gradient(135deg, rgba(99,102,241,.38), rgba(76,60,200,.22));
    border-bottom: 1px solid rgba(132,144,255,.22);
}
.piw-panel h3:active { cursor: move; }

.piw-card {
    background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07);
    border-radius: 10px; padding: 10px 12px; margin-bottom: 8px;
}
.piw-card-label {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px;
    color: #93a0e8; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,.08);
}

.piw-panel .piw-btn {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #e0e4ef; border-radius: 10px;
    padding: 6px 14px; cursor: pointer; font-size: 12px; transition: all .15s; font-weight: 500;
}
.piw-panel .piw-btn:hover { background: rgba(132,144,255,.25); border-color: rgba(132,144,255,.4); }
.piw-panel .piw-btn:active { background: rgba(132,144,255,.35); }
.piw-panel .piw-btn.piw-btn-primary { background: linear-gradient(135deg,#5b7fff,#4a6adf); border: none; color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(91,127,255,.3); }
.piw-panel .piw-btn.piw-btn-primary:hover { background: linear-gradient(135deg,#6b8fff,#5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.4); }

.piw-panel .piw-stat { font-size: 15px; font-weight: 700; text-align: center; margin: 1px 0; font-variant-numeric: tabular-nums; }
.piw-panel .piw-stat.piw-kills { color: #f0c040; }
.piw-panel .piw-stat.piw-captures { color: #4ade80; }

.piw-panel .piw-progress { height: 8px; background: rgba(255,255,255,.06); border-radius: 5px; overflow: hidden; margin: 3px 0; border: 1px solid rgba(255,255,255,.08); }
.piw-panel .piw-progress-bar { height: 100%; transition: width .3s; border-radius: 5px; }
.piw-bar-kills { background: linear-gradient(90deg,#f0c040,#d4a017); }
.piw-bar-caps { background: linear-gradient(90deg,#4ade80,#22c55e); }

.piw-panel .piw-dual-progress { display: flex; gap: 8px; margin: 4px 0; }
.piw-panel .piw-dual-progress-item { flex: 1; }
.piw-panel .piw-dual-progress-label { font-size: 10px; color: #9aa3bf; text-align: center; margin-bottom: 2px; font-weight: 500; }
.piw-panel .piw-dual-progress .piw-progress { height: 8px; }

.piw-panel .piw-route { font-size: 11px; color: #9aa3bf; text-align: center; }
.piw-panel .piw-leader { font-size: 11px; color: #c084fc; text-align: center; padding: 2px 0; }
.piw-panel .piw-shiny { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }

.piw-panel .piw-label { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 12px; color: #c8cddc; }
.piw-panel .piw-label input[type=number] {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
    color: #e0e4ef; padding: 5px 10px; font-size: 12px; width: 80px;
}
.piw-panel .piw-label input[type=number]:focus { outline: none; border-color: #60a5fa; }
.piw-check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; position: relative; }
.piw-check input[type=checkbox] { appearance: none; -webkit-appearance: none; width: 18px; height: 18px; border: 2px solid rgba(255,255,255,.2); border-radius: 5px; background: rgba(255,255,255,.06); cursor: pointer; transition: all .15s; flex-shrink: 0; position: relative; }
.piw-check input[type=checkbox]:checked { background: #5b7fff; border-color: #5b7fff; box-shadow: 0 0 8px rgba(91,127,255,.3); }
.piw-check input[type=checkbox]:checked::after { content: ''; position: absolute; left: 4px; top: 0px; width: 5px; height: 10px; border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.piw-check input[type=checkbox]:hover { border-color: #5b7fff; }
.piw-modal-toolbar .piw-check { font-size: 12px; color: #9aa3bf; }

.piw-panel .piw-row { display: flex; justify-content: space-between; align-items: center; gap: 4px; }

.piw-panel .piw-selected-tags { display: flex; flex-wrap: wrap; gap: 5px; margin: 6px 0; min-height: 20px; }
.piw-panel .piw-tag {
    background: rgba(74,222,128,.12); border: 1px solid rgba(74,222,128,.3); border-radius: 8px;
    padding: 3px 10px; font-size: 10px; color: #4ade80; font-weight: 500;
    display: flex; align-items: center; gap: 5px;
}
.piw-panel .piw-tag-remove { cursor: pointer; color: #f87171; font-weight: bold; font-size: 12px; }
.piw-panel .piw-tag-remove:hover { color: #ff4444; }

.piw-panel .piw-hint { font-size: 12px; color: #9aa3bf; text-align: center; margin-top: 4px; }

.piw-badge {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 600;
    letter-spacing: .3px; text-transform: uppercase;
}
.piw-badge-running { background: rgba(74,222,128,.12); color: #4ade80; border: 1px solid rgba(74,222,128,.2); }
.piw-badge-paused { background: rgba(248,113,113,.12); color: #f87171; border: 1px solid rgba(248,113,113,.2); }

.piw-panel .piw-city { font-size: 11px; color: #f0c040; text-align: center; padding: 2px 0; }
.piw-panel .piw-close { cursor: pointer; color: #a5b4fc; font-size: 16px; line-height: 1; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; transition: all .15s; }
.piw-panel .piw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-panel .piw-search {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
    color: #e0e4ef; padding: 6px 10px; font-size: 12px; width: 100%;
    box-sizing: border-box; margin-bottom: 4px;
}
.piw-panel .piw-search::placeholder { color: #848cb5; }
.piw-panel .piw-pokemon-list {
    max-height: 120px; overflow-y: auto; border: 1px solid rgba(255,255,255,.1);
    border-radius: 8px; margin-bottom: 6px; background: rgba(0,0,0,.2);
    scrollbar-width: thin; scrollbar-color: rgba(132,144,255,.4) rgba(255,255,255,.05);
}
.piw-panel .piw-pokemon-list::-webkit-scrollbar { width: 5px; }
.piw-panel .piw-pokemon-list::-webkit-scrollbar-track { background: rgba(255,255,255,.03); }
.piw-panel .piw-pokemon-list::-webkit-scrollbar-thumb { background: rgba(132,144,255,.35); border-radius: 99px; }

.piw-pokemon-item {
    padding: 4px 8px; cursor: pointer; font-size: 12px;
    display: flex; align-items: center; gap: 6px;
}
.piw-pokemon-item:hover { background: rgba(255,255,255,.07); }
.piw-pokemon-item.selected { background: rgba(74,222,128,.15); color: #4ade80; }
.piw-pokemon-item .piw-check { width: 14px; text-align: center; }
.piw-hunt-now { margin-left: auto; background: none; border: 1px solid rgba(255,255,255,.2); color: #9aa3bf; border-radius: 6px; padding: 2px 8px; font-size: 11px; cursor: pointer; transition: all .15s; opacity: 0; flex-shrink: 0; }
.piw-pokemon-item:hover .piw-hunt-now { opacity: 1; }
.piw-hunt-now:hover { background: #5b7fff; border-color: #5b7fff; color: #fff; }
.piw-panel .piw-filter-row { display: flex; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-filter-row input[type=checkbox] { width: auto; accent-color: #c084fc; }
.piw-panel .piw-pagination { display: flex; justify-content: center; align-items: center; gap: 6px; margin: 4px 0; font-size: 11px; }
.piw-panel .piw-pagination .piw-btn { padding: 2px 8px; font-size: 10px; }
.piw-panel .piw-pagination .piw-page-info { color: #7d86ad; }
.piw-pokemon-item .piw-shiny-icon { color: #f0c040; margin-left: 4px; }
.piw-panel .piw-btns-row { display: flex; gap: 6px; margin-bottom: 4px; }
.piw-panel .piw-btns-row .piw-btn { flex: 1; font-size: 10px; padding: 3px 6px; }

#piw-reopen {
    position: fixed; top: 5px; right: 10px; z-index: 2147483647;
    width: 34px; height: 34px; border-radius: 10px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3);
    color: #e0e4ef; font-size: 14px; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,.5); display: none;
    align-items: center; justify-content: center; transition: all .15s;
}
#piw-reopen:hover { background: rgba(132,144,255,.2); border-color: rgba(132,144,255,.5); }
.piw-modal-overlay {
    position: fixed; inset: 0; z-index: 2147483000;
    background: transparent; display: block;
    pointer-events: none;
}
.piw-modal { pointer-events: auto; }
.piw-modal {
    background: linear-gradient(165deg, rgba(20,24,38,.98), rgba(12,14,24,.98));
    border: 1px solid rgba(132,144,255,.3); border-radius: 16px;
    width: 800px; height: 600px;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 16px 50px rgba(0,0,0,.75), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(12px);
    position: fixed; top: calc(50vh - 300px); left: calc(50vw - 400px);
    min-width: 500px; min-height: 400px; color: #e7ebf7;
    font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
}
.piw-modal-resize {
    position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;
    cursor: nwse-resize; z-index: 30; opacity: .6;
    background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(147,160,232,.85) 3px 4.5px);
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
    transition: opacity .15s, transform .15s;
}
.piw-modal-resize:hover { opacity: 1; transform: scale(1.1); }
.piw-modal-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 18px; border-bottom: 1px solid rgba(132,144,255,.22);
    background: linear-gradient(135deg, rgba(99,102,241,.38), rgba(76,60,200,.22));
    cursor: move; user-select: none;
}
.piw-modal-header h3 { margin: 0; font-size: 15px; color: #fff; font-weight: 700; letter-spacing: .4px; user-select: none; flex: 1; }
.piw-modal-header .piw-modal-close {
    cursor: pointer; color: #a5b4fc; font-size: 18px; background: none;
    border: none; padding: 3px 8px; line-height: 1; border-radius: 6px;
    transition: all .15s;
}
.piw-modal-header .piw-modal-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-modal-toolbar {
    display: flex; gap: 10px; padding: 10px 18px; border-bottom: 1px solid rgba(132,144,255,.15);
    align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.02);
}
.piw-modal-toolbar input[type=text] {
    flex: 1; min-width: 150px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12);
    border-radius: 10px; color: #e0e4ef; padding: 7px 12px; font-size: 12.5px;
    transition: border-color .15s;
}
.piw-modal-toolbar input[type=text]:focus { outline: none; border-color: #60a5fa; box-shadow: 0 0 8px rgba(96,165,250,.25); }
.piw-modal-toolbar input[type=text]::placeholder { color: #7d86ad; }
.piw-modal-toolbar select {
    background: rgba(20,24,38,.9); border: 1px solid rgba(132,144,255,.25); border-radius: 10px;
    color: #e0e4ef; padding: 7px 12px; font-size: 12px; cursor: pointer;
    transition: border-color .15s;
}
.piw-modal-toolbar select:focus { outline: none; border-color: #60a5fa; }
.piw-modal-toolbar label:not(.piw-check) {
    display: flex; align-items: center; gap: 5px; font-size: 12px; color: #9aa3bf; cursor: pointer;
    padding: 5px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05);
    transition: all .15s;
}
.piw-modal-toolbar label:not(.piw-check):hover { border-color: #5b7fff; color: #e0e4ef; }
.piw-modal-toolbar label:not(.piw-check) input { accent-color: #5b7fff; }
.piw-modal-toolbar .piw-modal-count {
    font-size: 11px; color: #9aa3bf; white-space: nowrap;
}
.piw-modal-body {
    flex: 1; overflow-y: auto; padding: 16px 20px; margin-bottom: 12px;
    scrollbar-width: thin; scrollbar-color: rgba(132,144,255,.4) rgba(255,255,255,.05);
}
.piw-modal-body::-webkit-scrollbar { width: 6px; }
.piw-modal-body::-webkit-scrollbar-track { background: rgba(255,255,255,.04); border-radius: 99px; }
.piw-modal-body::-webkit-scrollbar-thumb { background: rgba(132,144,255,.38); border-radius: 99px; }
.piw-modal-body::-webkit-scrollbar-thumb:hover { background: rgba(132,144,255,.65); }
.piw-pokedex-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 10px;
}
.piw-poke-card {
    background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.08); border-radius: 12px;
    padding: 10px 6px; cursor: pointer; text-align: center; transition: all .2s;
    position: relative;
}
.piw-poke-card:hover { border-color: rgba(132,144,255,.4); background: rgba(255,255,255,.08); transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,.4); }
.piw-poke-card.selected { border-color: #4ade80; background: rgba(74,222,128,.15); box-shadow: 0 0 14px rgba(74,222,128,.2); }
.piw-poke-card .piw-poke-img {
    width: 56px; height: 56px; image-rendering: pixelated;
    margin: 0 auto 6px; display: block;
}
.piw-poke-card .piw-poke-num {
    font-size: 9px; color: #9aa3bf;
}
.piw-poke-card .piw-poke-name {
    font-size: 11px; color: #e0e4ef; font-weight: 600;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.piw-poke-card .piw-poke-level {
    font-size: 9px; color: #f0c040;
}
.piw-poke-card .piw-poke-types {
    display: flex; gap: 3px; justify-content: center; margin-top: 4px;
}
.piw-poke-card .piw-type-badge {
    font-size: 8px; padding: 2px 5px; border-radius: 4px;
    color: #fff; font-weight: 700; text-transform: uppercase; letter-spacing: .3px;
}
.piw-poke-card .piw-poke-check {
    position: absolute; top: 5px; right: 5px;
    width: 18px; height: 18px; border-radius: 50%;
    background: #4ade80; color: #000; font-size: 11px; font-weight: bold;
    display: none; align-items: center; justify-content: center;
    box-shadow: 0 2px 6px rgba(74,222,128,.4);
}
.piw-poke-card.selected .piw-poke-check { display: flex; }
.piw-poke-card .piw-poke-shiny {
    position: absolute; bottom: 6px; right: 6px; font-size: 12px;
}
.piw-hunt-card-btn { display: none; position: absolute; top: 6px; left: 6px; background: linear-gradient(135deg,#5b7fff,#4a6adf); border: none; color: #fff; border-radius: 6px; padding: 3px 8px; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .15s; z-index: 2; box-shadow: 0 2px 8px rgba(91,127,255,.3); }
.piw-poke-card:hover .piw-hunt-card-btn { display: block; }
.piw-hunt-card-btn:hover { background: linear-gradient(135deg,#6b8fff,#5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.5); }
.piw-modal-footer {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 20px; border-top: 1px solid rgba(132,144,255,.15);
    background: rgba(255,255,255,.02);
}
.piw-modal-footer .piw-btns-row { display: flex; gap: 8px; }
.piw-modal-footer .piw-btn {
    background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.1); color: #e0e4ef;
    border-radius: 8px; padding: 7px 16px; cursor: pointer; font-size: 12px;
    transition: all .15s;
}
.piw-modal-footer .piw-btn:hover { background: rgba(132,144,255,.25); border-color: rgba(132,144,255,.4); }
.piw-modal-footer .piw-selected-info { font-size: 13px; color: #9aa3bf; }
.piw-modal-footer .piw-btn-apply {
    background: linear-gradient(135deg, #5b7fff, #4a6adf); border: none;
    color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(91,127,255,.3);
}
.piw-modal-footer .piw-btn-apply:hover { background: linear-gradient(135deg, #6b8fff, #5a7aef); box-shadow: 0 4px 16px rgba(91,127,255,.4); }
.piw-type-badge {
    display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px;
    color: #fff; font-weight: 600; letter-spacing: .3px; text-transform: uppercase;
    margin: 0 2px; vertical-align: middle;
}

#piw-info-window {
    position: fixed; z-index: 2147483000; width: 340px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-info-window * { box-sizing: border-box; }
.piw-iw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: move; border-bottom: 1px solid rgba(132,144,255,.22);
    background: linear-gradient(135deg, rgba(99,102,241,.38), rgba(76,60,200,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-iw-title { display: flex; align-items: center; gap: 8px; }
.piw-iw-dot { width: 8px; height: 8px; border-radius: 50%; background: #a78bfa; box-shadow: 0 0 10px #a78bfa; }
.piw-iw-close { cursor: pointer; color: #a5b4fc; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-iw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-iw-body { padding: 12px; max-height: 80vh; overflow-y: auto; user-select: text; }

.piw-iw-hero { display: flex; gap: 12px; align-items: center; }
.piw-iw-sprite { width: 56px; height: 56px; image-rendering: pixelated; flex: none; object-fit: contain; background: radial-gradient(circle at 50% 40%, rgba(139,124,250,.25), rgba(139,124,250,.05)); border-radius: 10px; }
.piw-iw-name { font-size: 15px; font-weight: 700; color: #fff; }
.piw-iw-lv { color: #93a0e8; font-weight: 600; font-size: 12px; margin-left: 4px; }
.piw-iw-types { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
.piw-iw-type { color: #fff; border-radius: 99px; padding: 2px 9px; font-size: 10.5px; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,.2); }

.piw-iw-chips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.piw-iw-chip { background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.09); border-radius: 99px; padding: 2px 9px; font-size: 11px; white-space: nowrap; }
.piw-iw-chip-accent { background: linear-gradient(135deg, rgba(99,102,241,.4), rgba(139,92,246,.3)); border-color: rgba(139,124,250,.4); }

.piw-iw-bar-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 2px; }
.piw-iw-bar-tag { width: 32px; font-size: 10.5px; font-weight: 700; color: #93a0e8; }
.piw-iw-bar { flex: 1; height: 10px; background: rgba(255,255,255,.08); border-radius: 99px; overflow: hidden; }
.piw-iw-bar-fill { height: 100%; border-radius: 99px; }
.piw-iw-bar-val { min-width: 64px; text-align: right; font-size: 10.5px; color: #c6cdf0; font-variant-numeric: tabular-nums; }

.piw-iw-card { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.07); border-radius: 10px; padding: 10px; margin-bottom: 8px; }
.piw-iw-card:last-child { margin-bottom: 0; }
.piw-iw-sec { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: #93a0e8; margin-bottom: 8px; }
.piw-iw-sec small { text-transform: none; letter-spacing: 0; color: #7d86ad; font-weight: 600; }

.piw-iw-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.piw-iw-stat { background: rgba(255,255,255,.05); border-radius: 8px; padding: 5px 2px 4px; text-align: center; border-top: 2px solid var(--c); }
.piw-iw-stat-name { font-size: 10px; font-weight: 700; color: var(--c); letter-spacing: .5px; }
.piw-iw-stat-val { font-size: 13px; font-weight: 700; color: #fff; margin-top: 2px; }
.piw-iw-stat-base { font-size: 10px; color: #9aa3bf; margin-top: 3px; padding-top: 2px; border-top: 1px dashed rgba(255,255,255,.14); }
.piw-iw-stat-base b { color: #e7ebf7; }

.piw-iw-eff-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 4px 0; }
.piw-iw-eff-label { min-width: 75px; font-size: 11px; font-weight: 600; }

.piw-iw-iv-row { display: flex; align-items: center; gap: 7px; margin: 5px 0; }
.piw-iw-iv-name { width: 30px; font-size: 11px; font-weight: 700; }
.piw-iw-iv-growth { width: 48px; text-align: right; font-size: 10px; color: #7d86ad; font-variant-numeric: tabular-nums; }
.piw-iw-iv-val { min-width: 36px; text-align: center; background: rgba(255,255,255,.08); border-radius: 6px; padding: 1px 5px; font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; }
.piw-iw-sum { margin-top: 8px; font-size: 11px; }

#piw-moves-window {
    position: fixed; z-index: 2147483000; width: 300px;
    display: none; flex-direction: column;
    color: #e7ebf7; font-family: -apple-system, 'Segoe UI', Roboto, Inter, sans-serif;
    font-size: 12px;
    background: linear-gradient(165deg, rgba(20,24,38,.97), rgba(12,14,24,.97));
    border: 1px solid rgba(132,144,255,.3); border-radius: 14px;
    box-shadow: 0 14px 44px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.08);
    backdrop-filter: blur(10px); user-select: none;
    overflow: hidden;
}
#piw-moves-window * { box-sizing: border-box; }
.piw-mw-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; cursor: move; border-bottom: 1px solid rgba(132,144,255,.22);
    background: linear-gradient(135deg, rgba(99,102,241,.38), rgba(76,60,200,.22));
    font-weight: 700; font-size: 13px; letter-spacing: .4px;
}
.piw-mw-title { display: flex; align-items: center; gap: 8px; }
.piw-mw-dot { width: 8px; height: 8px; border-radius: 50%; background: #60a5fa; box-shadow: 0 0 10px #60a5fa; }
.piw-mw-close { cursor: pointer; color: #a5b4fc; font-size: 16px; font-weight: bold; line-height: 1; padding: 2px 6px; border-radius: 6px; }
.piw-mw-close:hover { color: #fff; background: rgba(255,255,255,.15); }
.piw-iw-body { padding: 12px; max-height: 80vh; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; margin-bottom: 12px; scrollbar-width: thin; scrollbar-color: rgba(132,144,255,.4) rgba(255,255,255,.05); }

.piw-mw-body { padding: 10px 12px; max-height: 75vh; overflow-y: auto; user-select: text; flex: 1 1 auto; min-height: 0; margin-bottom: 12px; scrollbar-width: thin; scrollbar-color: rgba(132,144,255,.4) rgba(255,255,255,.05); }

.piw-iw-body::-webkit-scrollbar,
.piw-mw-body::-webkit-scrollbar {
    width: 6px;
}
.piw-iw-body::-webkit-scrollbar-track,
.piw-mw-body::-webkit-scrollbar-track {
    background: rgba(255,255,255,.04);
    border-radius: 99px;
}
.piw-iw-body::-webkit-scrollbar-thumb,
.piw-mw-body::-webkit-scrollbar-thumb {
    background: rgba(132,144,255,.38);
    border-radius: 99px;
}
.piw-iw-body::-webkit-scrollbar-thumb:hover,
.piw-mw-body::-webkit-scrollbar-thumb:hover {
    background: rgba(132,144,255,.65);
}

.piw-win-resize {
    position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px;
    cursor: nwse-resize; z-index: 30; opacity: .6;
    background: repeating-linear-gradient(135deg, transparent 0 3px, rgba(147,160,232,.85) 3px 4.5px);
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
    transition: opacity .15s, transform .15s;
}
.piw-win-resize:hover { opacity: 1; transform: scale(1.1); }

.piw-mw-sub { font-size: 10.5px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; color: #93a0e8; }
.piw-mw-move { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 9px; border-radius: 8px; margin: 4px 0; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); flex-wrap: wrap; }
.piw-mw-active { border-color: rgba(250,204,21,.65); background: rgba(250,204,21,.10); box-shadow: 0 0 10px rgba(250,204,21,.12); }
.piw-mw-move-name { font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; color: #fff; }
.piw-mw-move-lv { font-weight: 700; font-size: 9.5px; color: #93a0e8; background: rgba(147,160,232,.14); border: 1px solid rgba(147,160,232,.3); border-radius: 99px; padding: 1px 5px; }
.piw-mw-move-cls { font-weight: 700; font-size: 9.5px; border: 1px solid; border-radius: 99px; padding: 1px 5px; }
.piw-mw-move-meta { display: flex; align-items: center; gap: 5px; margin-left: auto; }
`);

    // ========== UI & WINDOW FOCUSING ==========
    let highestZIndex = 2147483010;

    function bringToFront(el) {
        if (!el) return;
        highestZIndex++;
        el.style.zIndex = String(highestZIndex);
    }

    function makeBringableToFront(el) {
        if (!el) return;
        el.addEventListener('pointerdown', () => bringToFront(el));
        el.addEventListener('mousedown', () => bringToFront(el));
    }

    function makeDraggable(win, handle, storageKey) {
        if (!win || !handle) return;
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        const onStart = (e) => {
            if (e.target.closest('.piw-close, .piw-iw-close, .piw-mw-close, .piw-modal-close, input, button, select, label')) return;
            isDragging = true;
            const rect = win.getBoundingClientRect();
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = rect.left;
            initialTop = rect.top;
            win.style.left = `${initialLeft}px`;
            win.style.top = `${initialTop}px`;
            win.style.right = 'auto';
            win.style.bottom = 'auto';
            win.style.transform = 'none';
            bringToFront(win);
            e.preventDefault();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const minVisible = 40;
            const newLeft = Math.max(-win.offsetWidth + minVisible, Math.min(window.innerWidth - minVisible, initialLeft + dx));
            const newTop = Math.max(-10, Math.min(window.innerHeight - minVisible, initialTop + dy));
            win.style.left = `${newLeft}px`;
            win.style.top = `${newTop}px`;
        };

        const onEnd = () => {
            if (isDragging) {
                isDragging = false;
                if (storageKey) {
                    GM_setValue(storageKey, {
                        left: parseFloat(win.style.left),
                        top: parseFloat(win.style.top)
                    });
                }
            }
        };

        handle.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    }

    function makeResizable(win, resizeHandle, storageKey, minW = 240, minH = 160) {
        if (!win || !resizeHandle) return;
        let isResizing = false;
        let startX = 0, startY = 0;
        let startW = 0, startH = 0;

        const onStart = (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startW = win.offsetWidth;
            startH = win.offsetHeight;
            bringToFront(win);
            e.preventDefault();
            e.stopPropagation();
        };

        const onMove = (e) => {
            if (!isResizing) return;
            const newW = Math.max(minW, startW + (e.clientX - startX));
            const newH = Math.max(minH, startH + (e.clientY - startY));
            win.style.width = `${newW}px`;
            win.style.height = `${newH}px`;
        };

        const onEnd = () => {
            if (isResizing) {
                isResizing = false;
                if (storageKey) {
                    GM_setValue(storageKey, { w: Math.round(win.offsetWidth), h: Math.round(win.offsetHeight) });
                }
            }
        };

        resizeHandle.addEventListener('mousedown', onStart);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
    }

    function applyOpacityAll(pct) {
        const val = (pct != null ? pct : GM_getValue('piw_opacity', 100)) / 100;
        const panelEl = document.querySelector('.piw-panel');
        const infoWin = document.getElementById('piw-info-window');
        const movesWin = document.getElementById('piw-moves-window');
        const modalEl = document.querySelector('.piw-modal');
        if (panelEl) panelEl.style.opacity = String(val);
        if (infoWin) infoWin.style.opacity = String(val);
        if (movesWin) movesWin.style.opacity = String(val);
        if (modalEl) modalEl.style.opacity = String(val);
    }

    function isWindowOnTop(win) {
        if (!win) return false;
        const currentZ = parseInt(win.style.zIndex || '0', 10);
        return currentZ >= highestZIndex;
    }

    let panel;

    // Detecta se está em cidade
    function isCity() {
        if (!currentSlug) return false;
        return CITY_SLUGS.has(currentSlug);
    }

    function buildPanel() {
        panel = document.createElement('div');
        panel.className = 'piw-panel';
        makeBringableToFront(panel);
        panel.innerHTML = `
            <h3>Poke Helper <span style="display:flex;align-items:center;gap:6px"><span style="display:flex;align-items:center;gap:2px;font-size:11px;color:#9aa3bf">🔍 <input type="range" id="piw-opacity" min="40" max="100" value="${GM_getValue('piw_opacity',100)}" style="width:60px;accent-color:#5b7fff" title="${GM_getValue('piw_opacity',100)}%"></span><span id="piw-close-panel" class="piw-close" title="Fechar painel">✕</span></span></h3>
            <div class="piw-panel-inner">
                <div style="display:flex;gap:6px;justify-content:center;margin:2px 0 6px">
                <button class="piw-btn" id="piw-play" style="background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:7px 16px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(34,197,94,.3)" title="Iniciar caça">▶ Play</button>
                <button class="piw-btn" id="piw-stop" style="background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;padding:7px 16px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(239,68,68,.3)" title="Parar e voltar pra cidade">■ Stop</button>
                <button class="piw-btn" id="piw-reset" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:7px 12px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:12px;box-shadow:0 2px 8px rgba(99,102,241,.3)" title="Resetar contadores">↻ Reset</button>
                </div>
            <div style="text-align:center;margin-bottom:6px"><div id="piw-status"></div></div>
            <div class="piw-card">
                <div class="piw-city" id="piw-city-full" style="display:none">Cidade - auto-switch pausado</div>
                <div class="piw-leader" id="piw-leader">Líder: —</div>
                <div class="piw-shiny" id="piw-shiny">✨ Shiny: 0</div>
                <div class="piw-stat piw-kills" id="piw-kills">Abates: 0 / ${KILL_TARGET}</div>
                <div class="piw-stat piw-captures" id="piw-captures">Capturas: 0 / ${CAPTURE_TARGET}</div>
                <div class="piw-dual-progress">
                    <div class="piw-dual-progress-item">
                        <div class="piw-dual-progress-label">Abates</div>
                        <div class="piw-progress"><div class="piw-progress-bar piw-bar-kills" id="piw-bar-kills" style="width:0%"></div></div>
                    </div>
                    <div class="piw-dual-progress-item">
                        <div class="piw-dual-progress-label">Capturas</div>
                        <div class="piw-progress"><div class="piw-progress-bar piw-bar-caps" id="piw-bar-caps" style="width:0%"></div></div>
                    </div>
                </div>
                <div class="piw-route" id="piw-route" style="display:none">—</div>
                <div id="piw-hunting-display" style="text-align:center;margin-top:6px"></div>
            </div>
            <div class="piw-card">
                <div class="piw-card-label">Opções</div>
                <label class="piw-check">
                    <input type="checkbox" id="piw-shiny-only" ${shinyOnlyMode?'checked':''}>
                    Só trocar após capturar shiny
                </label>
                <label class="piw-check">
                    <input type="checkbox" id="piw-loop" ${loopMode?'checked':''}>
                    Modo loop (não remover da lista)
                </label>
                <label class="piw-check">
                    <input type="checkbox" id="piw-exit-kills" ${exitOnKills?'checked':''}>
                    Sair ao atingir abates
                </label>
                <label class="piw-check">
                    <input type="checkbox" id="piw-exit-captures" ${exitOnCaptures?'checked':''}>
                    Sair ao atingir capturas
                </label>
                <div class="piw-row" style="margin-top:6px">
                    <label class="piw-label" style="flex:1;margin:0">
                        Abates <input type="number" id="piw-target" value="${KILL_TARGET}" min="1" max="99999" style="width:80px">
                    </label>
                    <label class="piw-label" style="flex:1;margin:0">
                        Capturas <input type="number" id="piw-capture-target" value="${CAPTURE_TARGET}" min="1" max="99999" style="width:80px">
                    </label>
                </div>
            </div>
            <div class="piw-card">
                <div class="piw-card-label">Ferramentas</div>
                <div style="display:flex;gap:6px">
                    <button class="piw-btn" id="piw-toggle-iv" style="flex:1;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;padding:8px 6px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:11.5px;box-shadow:0 2px 8px rgba(139,92,246,.3)" title="Abrir/fechar janela flutuante de IVs e Stats">📊 IVs / Info</button>
                    <button class="piw-btn" id="piw-toggle-moves" style="flex:1;background:linear-gradient(135deg,#06b6d4,#0891b2);color:#fff;padding:8px 6px;border:none;border-radius:10px;cursor:pointer;font-weight:700;font-size:11.5px;box-shadow:0 2px 8px rgba(6,182,212,.3)" title="Abrir/fechar janela flutuante de Moves">⚔ Moves</button>
                </div>
            </div>
            <div class="piw-card">
                <div class="piw-card-label">Pokémon</div>
                <button class="piw-btn piw-btn-primary" id="piw-open-pokedex" style="width:100%;padding:7px 0;font-size:12px;font-weight:600">Selecionar Pokémon</button>
                <div class="piw-selected-tags" id="piw-selected-tags"></div>
                <div class="piw-hint" id="piw-hint">Nenhum selecionado</div>
            </div>
            </div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;



        const opacitySlider = panel.querySelector('#piw-opacity');
        if (opacitySlider) {
            applyOpacityAll(opacitySlider.value);
            opacitySlider.addEventListener('input', () => {
                const opacityVal = parseInt(opacitySlider.value) || 100;
                opacitySlider.title = opacityVal + '%';
                GM_setValue('piw_opacity', opacityVal);
                applyOpacityAll(opacityVal);
            });
        }

        // Fechar/reabrir painel
        const closeBtn = panel.querySelector('#piw-close-panel');
        const reopenBtn = document.createElement('button');
        reopenBtn.id = 'piw-reopen';
        reopenBtn.innerHTML = '🐾';
        reopenBtn.title = 'Abrir Auto Hunt';
        document.body.appendChild(reopenBtn);
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
            reopenBtn.style.display = 'flex';
        });
        reopenBtn.addEventListener('click', () => {
            panel.style.display = '';
            reopenBtn.style.display = 'none';
        });



        // Botão Play - iniciar caça
        panel.querySelector('#piw-play').addEventListener('click', () => {
            if (!busy && selectedPokemon.length > 0) {
                enabled = true;
                GM_setValue('piw_enabled', true);
                doSwitch();
            }
        });
        // Botão Stop - parar e voltar pra cidade
        panel.querySelector('#piw-stop').addEventListener('click', () => {
            enabled = false;
            GM_setValue('piw_enabled', false);
            syncUI();
            const houseBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], button.dock-btn[data-guide*="home"], button.dock-btn[data-guide*="city"], [class*="dock"] [class*="home"], [class*="dock"] [class*="city"]');
            if (houseBtn) {
                houseBtn.click();
                GM_log('[AutoHunt] Stop: voltando pra cidade');
            } else {
                GM_log('[AutoHunt] Stop: botão da casa não encontrado');
            }
        });
        panel.querySelector('#piw-shiny-only').onchange = function() {
            shinyOnlyMode = this.checked;
            GM_setValue('piw_shinyOnly', shinyOnlyMode);
            syncUI();
        };
        panel.querySelector('#piw-loop').onchange = function() {
            loopMode = this.checked;
            GM_setValue('piw_loopMode', loopMode);
            syncUI();
        };
        panel.querySelector('#piw-exit-kills').onchange = function() {
            exitOnKills = this.checked;
            GM_setValue('piw_exitOnKills', exitOnKills);
            syncUI();
        };
        panel.querySelector('#piw-exit-captures').onchange = function() {
            exitOnCaptures = this.checked;
            GM_setValue('piw_exitOnCaptures', exitOnCaptures);
            syncUI();
        };
        panel.querySelector('#piw-target').onchange = function() {
            GM_setValue('piw_killTarget', parseInt(this.value) || 100);
            syncUI();
        };
        panel.querySelector('#piw-capture-target').onchange = function() {
            GM_setValue('piw_captureTarget', parseInt(this.value) || 1);
            syncUI();
        };
        panel.querySelector('#piw-reset').onclick = () => { killCount = 0; captureCount = 0; syncUI(); };
        panel.querySelector('#piw-toggle-iv')?.addEventListener('click', toggleInfoWindow);
        panel.querySelector('#piw-toggle-moves')?.addEventListener('click', toggleMovesWindow);

        // Botão Pokédex
        panel.querySelector('#piw-open-pokedex').addEventListener('click', () => openPokedexModal());

        // Botão Começar caça (full view) - removido, agora é Play/Stop

        document.body.appendChild(panel);

        const savedPos = GM_getValue('piw_panelPos', null);
        if (savedPos) {
            const pl = parseFloat(savedPos.left);
            const pt = parseFloat(savedPos.top);
            if (!isNaN(pl)) { panel.style.left = pl + 'px'; panel.style.right = 'auto'; }
            if (!isNaN(pt)) { panel.style.top = pt + 'px'; panel.style.bottom = 'auto'; }
        }

        const savedSize = GM_getValue('piw_panelSize', null);
        if (savedSize && savedSize.w && savedSize.h) {
            panel.style.width = savedSize.w + 'px';
            panel.style.height = savedSize.h + 'px';
        }

        const title = panel.querySelector('h3');
        makeDraggable(panel, title, 'piw_panelPos');

        const resizeHandle = panel.querySelector('.piw-win-resize');
        makeResizable(panel, resizeHandle, 'piw_panelSize', 340, 200);

        renderSelectedTags();
        renderPokemonList('');
    }

    function syncUI() {
        // Atualiza leaderLevel com o mesmo fallback da janela de IVs:
        // 1) currentLeaderData (WebSocket), 2) getLeaderLevelFromDOM() (DOM do jogo)
        if (leaderName) {
            const domLv = getLeaderLevelFromDOM();
            if (domLv !== null && domLv > 0) leaderLevel = domLv;
            else if (!leaderLevel && currentLeaderData) {
                leaderLevel = currentLeaderData.level || currentLeaderData.lvl || currentLeaderData.pokemonLevel || 0;
            }
        }

        const target = GM_getValue('piw_killTarget', 100);
        const capTarget = GM_getValue('piw_captureTarget', 1);
        const killsEl = document.getElementById('piw-kills');
        const capsEl = document.getElementById('piw-captures');
        const barKills = document.getElementById('piw-bar-kills');
        const barCaps = document.getElementById('piw-bar-caps');
        const re = document.getElementById('piw-route');
        const st = document.getElementById('piw-status');
        const cityEl = document.getElementById('piw-city-full');
        const leaderEl = document.getElementById('piw-leader');
        const shinyEl = document.getElementById('piw-shiny');
        if (killsEl) killsEl.textContent = `Abates: ${killCount} / ${target}`;
        if (capsEl) capsEl.textContent = `Capturas: ${captureCount} / ${capTarget}`;
        if (barKills) barKills.style.width = Math.min(100, killCount/target*100) + '%';
        if (barCaps) barCaps.style.width = Math.min(100, captureCount/capTarget*100) + '%';
        if (re)  re.textContent  = currentRoute || '—';
        if (st) {
            st.innerHTML = enabled
                ? '<span class="piw-badge piw-badge-running">● Rodando</span>'
                : '<span class="piw-badge piw-badge-paused">○ Pausado</span>';
        }
        if (cityEl) {
            const inCity = isCity();
            cityEl.style.display = inCity ? 'block' : 'none';
        }
        if (leaderEl) {
            if (leaderName) {
                const imgUrl = getPokemonImageUrl(leaderPokeId, leaderName, true);
                const fallbackUrl = getPokemonImageUrl(leaderPokeId, leaderName, false);
                const typeBadges = leaderTypes.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${t}</span>`).join(' ');
                leaderEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:10px">${imgUrl ? `<div style="width:52px;height:52px;border:2px solid #3d4a6a;border-radius:10px;background:#131720;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${imgUrl}" style="width:44px;height:44px;image-rendering:pixelated" onerror="this.onerror=null;this.src='${fallbackUrl}'"></div>` : ''}<div style="text-align:left"><div style="display:flex;align-items:baseline;gap:6px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${leaderName}</span><span style="color:#9aa3bf;font-size:12px">Lv ${leaderLevel || '?'}</span></div><div style="display:flex;gap:4px;margin-top:3px">${typeBadges}</div></div></div>`;
            } else {
                leaderEl.textContent = '—';
            }
        }
        if (shinyEl) {
            shinyEl.textContent = `✨ Shiny: ${shinyCount}`;
        }
        const leaderMini = document.getElementById('piw-leader-mini');
        if (leaderMini) {
            if (leaderName) {
                const imgUrl = getPokemonImageUrl(leaderPokeId, leaderName, true);
                const fallbackUrl = getPokemonImageUrl(leaderPokeId, leaderName, false);
                const typeBadges = leaderTypes.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:8px;padding:1px 5px">${t}</span>`).join(' ');
                leaderMini.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;gap:8px">${imgUrl ? `<div style="width:38px;height:38px;border:2px solid #3d4a6a;border-radius:8px;background:#131720;display:flex;align-items:center;justify-content:center;flex-shrink:0"><img src="${imgUrl}" style="width:32px;height:32px;image-rendering:pixelated" onerror="this.onerror=null;this.src='${fallbackUrl}'"></div>` : ''}<div style="text-align:left"><div style="display:flex;align-items:baseline;gap:5px"><span style="color:#e0e4ef;font-weight:700;font-size:13px">${leaderName}</span><span style="color:#9aa3bf;font-size:10px">Lv ${leaderLevel || '?'}</span></div><div style="display:flex;gap:3px;margin-top:2px">${typeBadges}</div></div></div>`;
            } else {
                leaderMini.textContent = '—';
            }
        }
        const shinyMini = document.getElementById('piw-shiny-mini');
        if (shinyMini) shinyMini.textContent = `✨ Shiny: ${shinyCount}`;
        const killsMini = document.getElementById('piw-kills-mini');
        const capsMini = document.getElementById('piw-caps-mini');
        const barKillsMini = document.getElementById('piw-bar-kills-mini');
        const barCapsMini = document.getElementById('piw-bar-caps-mini');
        if (killsMini) killsMini.textContent = `Abates: ${killCount} / ${target}`;
        if (capsMini) capsMini.textContent = `Capturas: ${captureCount} / ${capTarget}`;
        if (barKillsMini) barKillsMini.style.width = Math.min(100, killCount/target*100) + '%';
        if (barCapsMini) barCapsMini.style.width = Math.min(100, captureCount/capTarget*100) + '%';
        const routeMini = document.getElementById('piw-route-mini');
        if (routeMini) routeMini.textContent = currentRoute || '—';
        const startMini = document.getElementById('piw-start-hunt-mini');
        if (startMini) startMini.style.display = (isCity() && selectedPokemon.length > 0 && !busy) ? 'block' : 'none';
        const huntEl = document.getElementById('piw-hunting-display');
        const huntElMini = document.getElementById('piw-hunting-display-mini');
        const huntHTML = (huntingPokemon && selectedPokemon.length > 0) ? (() => {
            const creature = creatures.find(c => c.name?.toLowerCase() === huntingPokemon.toLowerCase());
            const types = [creature?.type1, creature?.type2].filter(Boolean);
            const typeBadges = types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'};font-size:9px;padding:1px 6px">${t}</span>`).join(' ');
            return `<div style="display:flex;align-items:center;justify-content:center;gap:8px"><span style="color:#e0e4ef;font-weight:700;font-size:15px">${huntingPokemon}</span><span style="color:#9aa3bf;font-size:12px">Lv ${leaderLevel || '?'}</span><span style="display:flex;gap:4px">${typeBadges}</span></div>`;
        })() : '';
        if (huntEl) huntEl.innerHTML = huntHTML;
        if (huntElMini) huntElMini.innerHTML = huntHTML;
        saveState();
        renderInfoWindow();
        renderMovesWindow();
    }

    function createInfoWindowDOM() {
        if (document.getElementById('piw-info-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-info-window';

        const storedPos = GM_getValue('piw_info_win_pos', { left: 400, top: 120 });
        const storedSize = GM_getValue('piw_info_win_size', null);
        const iwL = parseFloat(storedPos.left);
        const iwT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(iwL) ? iwL : 400}px`;
        win.style.top = `${!isNaN(iwT) ? iwT : 120}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = infoWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-iw-head">
                <span class="piw-iw-title"><span class="piw-iw-dot"></span>Pokémon IVs & Stats</span>
                <span class="piw-iw-close" id="piw-iw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-iw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-iw-close-btn').addEventListener('click', closeInfoWindow);

        const head = win.querySelector('.piw-iw-head');
        makeDraggable(win, head, 'piw_info_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_info_win_size', 260, 180);
    }

    function closeInfoWindow() {
        infoWindowVisible = false;
        GM_setValue('piw_info_win_visible', false);
        const win = document.getElementById('piw-info-window');
        if (win) win.style.display = 'none';
    }

    function toggleInfoWindow() {
        let win = document.getElementById('piw-info-window');
        if (!win) {
            createInfoWindowDOM();
            win = document.getElementById('piw-info-window');
        }
        if (!win) return;

        infoWindowVisible = !infoWindowVisible;
        GM_setValue('piw_info_win_visible', infoWindowVisible);
        win.style.display = infoWindowVisible ? 'flex' : 'none';
        if (infoWindowVisible) {
            bringToFront(win);
            renderInfoWindow();
        }
    }

    function renderInfoWindow() {
        const win = document.getElementById('piw-info-window');
        if (!win || !infoWindowVisible) return;

        const body = win.querySelector('.piw-iw-body');
        if (!body) return;

        let leader = currentLeaderData;
        if (!leader && leaderName) {
            const c = creatures.find(c => c.name?.toLowerCase() === leaderName.toLowerCase());
            if (c) {
                leader = {
                    name: c.name,
                    speciesId: c.pokeId || c.id,
                    level: leaderLevel || 1,
                    type1: c.type1,
                    type2: c.type2
                };
            }
        }
        if (!leader) {
            const domLeader = getLeaderFromDOM();
            if (domLeader) {
                leaderName = domLeader.name;
                leaderLevel = domLeader.level;
                const c = creatures.find(c => c.name?.toLowerCase() === domLeader.name.toLowerCase());
                if (c) {
                    leader = {
                        name: c.name,
                        speciesId: c.pokeId || c.id,
                        level: domLeader.level,
                        type1: c.type1,
                        type2: c.type2
                    };
                } else {
                    leader = {
                        name: domLeader.name,
                        level: domLeader.level
                    };
                }
            }
        }

        if (!leader) {
            body.innerHTML = '<div style="color:#aab3d6;padding:12px;text-align:center">Aguardando dados do pokémon líder…</div>';
            return;
        }

        const name = leader.name || leaderName || '?';
        const level = leader.level || leaderLevel || 1;
        const speciesId = leader.speciesId || leader.pokeId || leaderPokeId || (() => {
            const c = creatures.find(c => c.name?.toLowerCase() === name.toLowerCase());
            return c?.pokeId || c?.id || 0;
        })();

        const types = [leader.type1, leader.type2].filter(Boolean);
        if (types.length === 0 && leaderTypes.length > 0) types.push(...leaderTypes);

        const isShiny = Boolean(leader.shiny);
        const sprites = getPokemonSpriteUrls(speciesId, isShiny);

        const ivTotal = leader.ivTotal ?? '?';
        const quality = leader.quality;
        const qTier = getQualityTier(quality);
        const power = leader.power ?? '?';
        const sellVal = leader.sellValue ?? '?';

        const domData = getLeaderStatsFromDOM();
        const hpCurrent = leader.hp ?? domData?.hpCurrent ?? '?';
        const hpMax = leader.maxHp ?? domData?.hpMax ?? '?';
        const expPct = leader.expPct ?? domData?.expPct ?? null;

        const baseStats = getBaseStatsForSpecies(speciesId);
        const calculatedIVs = computeExactIVs({ ...leader, speciesId, level });

        let qualityChipHtml = `<span class="piw-iw-chip">Quality <b>${quality ?? '?'}</b></span>`;
        if (qTier && quality) {
            if (isShiny) {
                qualityChipHtml = `<span class="piw-iw-chip" style="color:#fff;background:linear-gradient(120deg, ${qTier.color}40, ${qTier.color}cc, ${qTier.color}40);border-color:${qTier.color}">Quality <b>${quality}</b></span>`;
            } else {
                qualityChipHtml = `<span class="piw-iw-chip" style="color:${qTier.color};background:${qTier.color}26;border-color:${qTier.color}99" title="${qTier.name}">Quality <b>${quality}</b></span>`;
            }
        }

        const heroHtml = `
            <div class="piw-iw-hero">
                ${sprites ? `<img class="piw-iw-sprite" src="${sprites.anim}" onerror="this.onerror=null;this.src='${sprites.still}'">` : ''}
                <div style="min-width:0">
                    <div class="piw-iw-name">${name}${isShiny ? ' <span style="color:#ffd54a">✨</span>' : ''}<span class="piw-iw-lv">Lv ${level}</span></div>
                    <div class="piw-iw-types">
                        ${types.map(t => {
                            const bg = TYPE_COLORS_MAP[t.toLowerCase()] || TYPE_COLORS[t.toUpperCase()] || '#888';
                            const pt = TYPE_PT_MAP[t.toLowerCase()] || t;
                            return `<span class="piw-iw-type" style="background:${bg}">${pt}</span>`;
                        }).join('')}
                    </div>
                </div>
            </div>
            <div class="piw-iw-chips">
                <span class="piw-iw-chip piw-iw-chip-accent">IV total <b>${ivTotal}</b></span>
                ${qualityChipHtml}
                <span class="piw-iw-chip">⚡ ${power}</span>
                ${sellVal !== '?' ? `<span class="piw-iw-chip">💰 ${sellVal}</span>` : ''}
                ${getClanForPokemon(types, GM_getValue('piw_myClan', ''))}
            </div>
        `;

        let hpPct = 0;
        if (Number.isFinite(Number(hpCurrent)) && Number.isFinite(Number(hpMax)) && Number(hpMax) > 0) {
            hpPct = Math.max(0, Math.min(100, (Number(hpCurrent) / Number(hpMax)) * 100));
        }
        const hpColor = hpPct > 50 ? '#7ac74c' : hpPct > 20 ? '#facc15' : '#f87171';

        const barsHtml = `
            <div class="piw-iw-bar-row">
                <span class="piw-iw-bar-tag">HP</span>
                <div class="piw-iw-bar">
                    <div class="piw-iw-bar-fill" style="width:${hpPct.toFixed(1)}%;background:linear-gradient(90deg, ${hpColor}cc, ${hpColor})"></div>
                </div>
                <span class="piw-iw-bar-val">${hpCurrent}/${hpMax}</span>
            </div>
            ${expPct !== null ? `
            <div class="piw-iw-bar-row">
                <span class="piw-iw-bar-tag">EXP</span>
                <div class="piw-iw-bar">
                    <div class="piw-iw-bar-fill" style="width:${Math.max(0, Math.min(100, expPct)).toFixed(1)}%;background:linear-gradient(90deg, #818cf8cc, #818cf8)"></div>
                </div>
                <span class="piw-iw-bar-val">${Number(expPct).toFixed(1)}%</span>
            </div>` : ''}
        `;

        const statsObj = leader.stats || {};
        const statsGridHtml = `
            <div class="piw-iw-card">
                <div class="piw-iw-sec">• STATS</div>
                <div class="piw-iw-stats">
                    ${STAT_KEYS.map(k => {
                        const val = statsObj[k] ?? '?';
                        const baseVal = baseStats ? baseStats[k] : '?';
                        const c = STAT_COLORS[k];
                        const label = STAT_LABELS[k];
                        return `
                            <div class="piw-iw-stat" style="--c:${c}">
                                <div class="piw-iw-stat-name">${label}</div>
                                <div class="piw-iw-stat-val">${val}</div>
                                <div class="piw-iw-stat-base">base <b>${baseVal}</b></div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        const effHtml = calculateMatchupsHtml(types);
        const effSectionHtml = effHtml ? `
            <div class="piw-iw-card">
                <div class="piw-iw-sec">• EFETIVIDADE</div>
                ${effHtml}
            </div>
        ` : '';

        let ivsSectionHtml = '';
        if (calculatedIVs) {
            let ivSumMin = 0, ivSumMax = 0;
            const ivRows = STAT_KEYS.map(k => {
                const range = calculatedIVs[k];
                ivSumMin += range.min;
                ivSumMax += range.max;
                const rangeTxt = range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
                const pct = Math.max(0, Math.min(100, (range.max / 32) * 100));
                const c = STAT_COLORS[k];
                const label = STAT_LABELS[k];
                return `
                    <div class="piw-iw-iv-row">
                        <span class="piw-iw-iv-name" style="color:${c}">${label}</span>
                        <div class="piw-iw-bar">
                            <div class="piw-iw-bar-fill" style="width:${pct.toFixed(1)}%;background:linear-gradient(90deg, ${c}cc, ${c})"></div>
                        </div>
                        <span class="piw-iw-iv-val" style="color:${c}">${rangeTxt}</span>
                    </div>
                `;
            }).join('');

            const exactMatchesTotal = ivSumMin === ivSumMax && Number.isFinite(Number(ivTotal)) && ivSumMin === Number(ivTotal);
            const sumNote = ivSumMin === ivSumMax
                ? `<div class="piw-iw-sum" style="color:${exactMatchesTotal ? '#9fe08a' : '#ffb04a'}">Σ IVs = ${ivSumMin}${exactMatchesTotal ? ' ✓ confere com o IV total' : ''}</div>`
                : `<div class="piw-iw-sum" style="color:#aab3d6">Intervalos fecham com o ganho de níveis.</div>`;

            ivsSectionHtml = `
                <div class="piw-iw-card">
                    <div class="piw-iw-sec">• IVS POR STAT <small>· exatos, fórmula do jogo</small></div>
                    ${ivRows}
                    ${sumNote}
                </div>
            `;
        }

        body.innerHTML = `
            <div class="piw-iw-card">
                ${heroHtml}
                ${barsHtml}
            </div>
            ${statsGridHtml}
            ${effSectionHtml}
            ${ivsSectionHtml}
        `;
    }

    // ========== JANELA DE MOVES ==========
    let movesWindowVisible = GM_getValue('piw_moves_win_visible', false);
    let observedMovesMap = new Map();
    let currentActiveMove = null;

    const MOVE_CLASSES = {
        physical: { label: "Físico", short: "🗡", color: "#f97316" },
        special: { label: "Especial", short: "🌀", color: "#38bdf8" },
        status: { label: "Status", short: "💫", color: "#a1a1aa" }
    };

    function getMoveClassBadge(category) {
        const catKey = String(category || "").toLowerCase();
        const cls = MOVE_CLASSES[catKey];
        if (!cls) return "";
        return `<span class="piw-mw-move-cls" title="${cls.label}" style="color:${cls.color};background:${cls.color}22;border-color:${cls.color}66">${cls.short} ${cls.label}</span>`;
    }

    function extractPokemonMoves(leaderObj, creatureObj) {
        const getList = (item) => {
            if (typeof item === 'string') return { name: item };
            if (!item || typeof item !== 'object') return null;
            const name = item.name || item.moveName || item.move || item.id;
            if (!name) return null;
            return {
                name: String(name),
                power: item.power ?? item.basePower ?? item.damage ?? item.dmg ?? null,
                type: item.type != null ? String(item.type) : (item.element != null ? String(item.element) : null),
                cooldown: item.cooldownMs ?? item.cooldown ?? item.cd ?? null,
                category: item.category ?? item.damageClass ?? item.kind ?? null,
                learnLevel: item.learnLevel ?? item.level ?? item.levelLearned ?? null
            };
        };

        const sources = [
            leaderObj?.moves, leaderObj?.attacks, leaderObj?.skills, leaderObj?.spells,
            creatureObj?.moves, creatureObj?.attacks, creatureObj?.skills, creatureObj?.spells
        ];

        for (const src of sources) {
            if (Array.isArray(src) && src.length > 0) {
                const list = src.map(getList).filter(Boolean);
                if (list.length > 0) return list;
            }
        }
        return [];
    }

    function extractCombatHit(data, depth = 0, parentKey = '') {
        if (!data || typeof data !== 'object' || depth > 5) return null;
        const moveName = data.moveName || data.attackName || data.spellName || (typeof data.move === 'string' ? data.move : data.move?.name) || data.attack;
        const dmg = Number(data.damage ?? data.dmg ?? data.dano ?? data.amount);
        if (typeof moveName === 'string' && moveName.trim() && Number.isFinite(dmg)) {
            const isTaken = Boolean(
                data.taken || data.received || data.incoming ||
                /taken|received|incoming|enemy|foe|mob|wild/i.test(parentKey)
            );
            return {
                name: moveName.trim(),
                dmg: dmg,
                type: typeof data.type === 'string' ? data.type : null,
                eff: Number.isFinite(Number(data.eff)) ? Number(data.eff) : null,
                taken: isTaken
            };
        }
        for (const [key, val] of Object.entries(data)) {
            if (typeof val === 'object' && val !== null) {
                const sub = extractCombatHit(val, depth + 1, key);
                if (sub) return sub;
            }
        }
        return null;
    }

    function createMovesWindowDOM() {
        if (document.getElementById('piw-moves-window')) return;

        const win = document.createElement('div');
        win.id = 'piw-moves-window';

        const storedPos = GM_getValue('piw_moves_win_pos', { left: 760, top: 120 });
        const storedSize = GM_getValue('piw_moves_win_size', null);
        const mwL = parseFloat(storedPos.left);
        const mwT = parseFloat(storedPos.top);
        win.style.left = `${!isNaN(mwL) ? mwL : 760}px`;
        win.style.top = `${!isNaN(mwT) ? mwT : 120}px`;
        if (storedSize && storedSize.w) win.style.width = `${storedSize.w}px`;
        if (storedSize && storedSize.h) win.style.height = `${storedSize.h}px`;
        win.style.display = movesWindowVisible ? 'flex' : 'none';

        win.innerHTML = `
            <div class="piw-mw-head">
                <span class="piw-mw-title"><span class="piw-mw-dot"></span>⚔ Moves do Pokémon</span>
                <span class="piw-mw-close" id="piw-mw-close-btn" title="Fechar">✕</span>
            </div>
            <div class="piw-mw-body"></div>
            <div class="piw-win-resize" title="Arraste para redimensionar"></div>
        `;

        makeBringableToFront(win);
        document.body.appendChild(win);
        applyOpacityAll();

        win.querySelector('#piw-mw-close-btn').addEventListener('click', closeMovesWindow);

        const head = win.querySelector('.piw-mw-head');
        makeDraggable(win, head, 'piw_moves_win_pos');

        const resizeHandle = win.querySelector('.piw-win-resize');
        makeResizable(win, resizeHandle, 'piw_moves_win_size', 220, 160);
    }

    function closeMovesWindow() {
        movesWindowVisible = false;
        GM_setValue('piw_moves_win_visible', false);
        const win = document.getElementById('piw-moves-window');
        if (win) win.style.display = 'none';
    }

    function toggleMovesWindow() {
        let win = document.getElementById('piw-moves-window');
        if (!win) {
            createMovesWindowDOM();
            win = document.getElementById('piw-moves-window');
        }
        if (!win) return;

        movesWindowVisible = !movesWindowVisible;
        GM_setValue('piw_moves_win_visible', movesWindowVisible);
        win.style.display = movesWindowVisible ? 'flex' : 'none';
        if (movesWindowVisible) {
            bringToFront(win);
            renderMovesWindow();
        }
    }

    function renderMovesWindow() {
        const win = document.getElementById('piw-moves-window');
        if (!win || !movesWindowVisible) return;

        const body = win.querySelector('.piw-mw-body');
        if (!body) return;

        let leader = currentLeaderData;
        let creature = creatures.find(c => c.name?.toLowerCase() === (leader?.name || leaderName || '').toLowerCase());

        const moves = extractPokemonMoves(leader, creature);
        const knownMovesMap = new Map(moves.map(m => [m.name.toLowerCase(), m]));
        const hasKnownMoves = moves.length > 0;

        const pokemonMoves = [...moves];
        const takenMovesMap = new Map();

        for (const [nameKey, obs] of observedMovesMap.entries()) {
            const isTaken = obs.taken || (hasKnownMoves && !knownMovesMap.has(nameKey));
            if (isTaken) {
                takenMovesMap.set(nameKey, obs);
            } else {
                if (knownMovesMap.has(nameKey)) {
                    const m = knownMovesMap.get(nameKey);
                    m.lastDmg = obs.dmg;
                    m.lastEff = obs.eff;
                    if (!m.type && obs.type) m.type = obs.type;
                } else {
                    pokemonMoves.push({
                        name: obs.name,
                        type: obs.type,
                        lastDmg: obs.dmg,
                        lastEff: obs.eff,
                        observed: true
                    });
                }
            }
        }

        const name = leader?.name || leaderName || '?';
        const level = leader?.level || leaderLevel || 1;
        const takenMovesList = Array.from(takenMovesMap.values());

        if (pokemonMoves.length === 0 && takenMovesList.length === 0) {
            body.innerHTML = `
                <div class="piw-mw-sub" style="margin-bottom:6px">⚔ Moves de ${name} (Lv ${level})</div>
                <div style="color:#aab3d6;padding:12px 6px;text-align:center">
                    Ainda não vi os moves deste pokémon.<br>
                    Deixe-o batalhar — os golpes usados e o dano aparecem aqui automaticamente.
                </div>
            `;
            return;
        }

        const renderMoveItem = (m, isTaken = false) => {
            const typeKey = m.type ? String(m.type).toLowerCase() : null;
            const bgType = typeKey && TYPE_COLORS_MAP[typeKey] ? TYPE_COLORS_MAP[typeKey] : null;
            const ptType = typeKey && TYPE_PT_MAP[typeKey] ? TYPE_PT_MAP[typeKey] : (m.type || 'Normal');

            const isCurrent = !isTaken && currentActiveMove && m.name.toLowerCase() === currentActiveMove.toLowerCase();
            const dmgVal = m.lastDmg ?? m.dmg;
            const effVal = m.lastEff ?? m.eff;
            const effTxt = Number.isFinite(Number(effVal)) && Number(effVal) !== 1 ? `${Math.round(Number(effVal) * 100) / 100}x` : '';

            return `
                <div class="piw-mw-move ${isCurrent ? 'piw-mw-active' : ''}">
                    <span class="piw-mw-move-name">
                        ${isCurrent ? '▶ ' : ''}${m.name}
                        ${m.learnLevel != null ? `<span class="piw-mw-move-lv">Nv ${m.learnLevel}</span>` : ''}
                        ${getMoveClassBadge(m.category)}
                    </span>
                    <span class="piw-mw-move-meta">
                        ${bgType ? `<span class="piw-iw-type" style="background:${bgType};font-size:9.5px;padding:1px 6px">${ptType}</span>` : ''}
                        ${m.power != null ? `<span style="color:#aab3d6;font-size:10.5px">poder ${m.power}</span>` : ''}
                        ${dmgVal != null ? `
                            <span style="color:${isTaken ? '#f87171' : '#ffd54a'};font-weight:700">
                                ${isTaken ? '🛡' : '💥'} ${Number(dmgVal).toLocaleString('pt-BR')}
                            </span>
                            ${effTxt ? `<span style="color:#aab3d6;font-size:10.5px">${effTxt}</span>` : ''}
                        ` : ''}
                    </span>
                </div>
            `;
        };

        let html = `<div class="piw-mw-sub" style="margin-bottom:6px">⚔ Moves de <b>${name}</b> (Lv ${level})</div>`;
        html += pokemonMoves.map(m => renderMoveItem(m, false)).join('');

        if (takenMovesList.length > 0) {
            html += `<div class="piw-mw-sub" style="margin-top:12px;margin-bottom:6px">🛡 GOLPES TOMADOS <small style="color:#7d86ad;text-transform:none;letter-spacing:0">· nesta hunt</small></div>`;
            html += takenMovesList.map(m => renderMoveItem(m, true)).join('');
        }

        body.innerHTML = html;
    }



    // ========== POKEMON SELECTOR ==========
    function renderSelectedTags() {
        const container = document.getElementById('piw-selected-tags');
        const hint = document.getElementById('piw-hint');
        if (!container) return;
        container.innerHTML = selectedPokemon.map((name, idx) =>
            `<span class="piw-tag" draggable="true" data-idx="${idx}" style="cursor:move">${name} <span class="piw-tag-remove" data-name="${name}">&times;</span></span>`
        ).join('');
        if (hint) {
            hint.textContent = selectedPokemon.length === 0
                ? 'Nenhum selecionado'
                : `${selectedPokemon.length} selecionado(s)`;
        }
        // Event listeners para remover
        container.querySelectorAll('.piw-tag-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                selectedPokemon = selectedPokemon.filter(n => n !== btn.dataset.name);
                GM_setValue('piw_selectedPokemon', selectedPokemon);
                renderSelectedTags();
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            });
        });
        // Drag and drop pra reordenar
        let dragIdx = null;
        container.querySelectorAll('.piw-tag').forEach(tag => {
            tag.addEventListener('dragstart', (e) => {
                dragIdx = parseInt(tag.dataset.idx);
                tag.style.opacity = '0.4';
                e.dataTransfer.effectAllowed = 'move';
            });
            tag.addEventListener('dragend', () => {
                tag.style.opacity = '1';
                dragIdx = null;
                container.querySelectorAll('.piw-tag').forEach(t => { t.style.borderTop = ''; t.style.boxShadow = ''; });
            });
            tag.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                tag.style.borderTop = '2px solid #5b7fff';
                tag.style.boxShadow = '0 -2px 8px rgba(91,127,255,.4)';
            });
            tag.addEventListener('dragleave', () => {
                tag.style.borderTop = '';
                tag.style.boxShadow = '';
            });
            tag.addEventListener('drop', (e) => {
                e.preventDefault();
                tag.style.borderTop = '';
                const dropIdx = parseInt(tag.dataset.idx);
                if (dragIdx !== null && dragIdx !== dropIdx) {
                    const item = selectedPokemon.splice(dragIdx, 1)[0];
                    selectedPokemon.splice(dropIdx, 0, item);
                    GM_setValue('piw_selectedPokemon', selectedPokemon);
                    renderSelectedTags();
                }
            });
        });
    }

    // Set de IDs de lendários/míticos/não-capturáveis que não possuem rota de caça no mapa
    const NON_HUNTABLE_SPECIES_IDS = new Set([
        144, 145, 146, 150, 151, // Articuno, Zapdos, Moltres, Mewtwo, Mew
        243, 244, 245, 249, 250, 251, // Raikou, Entei, Suicune, Lugia, Ho-Oh, Celebi
        377, 378, 379, 380, 381, 382, 383, 384, 385, 386, // Regis, Latios/as, Weather, Jirachi, Deoxys
        480, 481, 482, 483, 484, 485, 486, 487, 488, 489, 490, 491, 492, 493, // Gen 4 Legendaries/Mythicals
        638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649, // Gen 5 Legendaries
        716, 717, 718, 719, 720, 721, // Gen 6 Legendaries
        785, 786, 787, 788, 789, 790, 791, 792, 800, 801, 802, 807, 808, 809 // Gen 7 Legendaries
    ]);

    function getFilteredPokemonList(filter) {
        const NAME_MAP = {
            'nidoranfe': 'Nidoran Female',
            'nidoranma': 'Nidoran Male',
            'farfetchd': 'Farfetchd',
            'farfetch': 'Farfetchd',
            'mrmime': 'Mr. Mime',
            'hooh': 'Ho-oh',
        };
        const pokemonMap = new Map();

        const getNormalizedKey = (name) => {
            if (!name) return '';
            const rawKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const mapped = NAME_MAP[rawKey] || name;
            return mapped.toLowerCase().replace(/[^a-z0-9]/g, '');
        };

        // 1. Popula com espécies válidas de criaturas que não são lendárias sem rota
        if (creatures && creatures.length > 0) {
            for (const c of creatures) {
                if (!c.name || c.pokeId >= 10000) continue;
                const key = getNormalizedKey(c.name);
                const routeMatch = routes.find(r => getNormalizedKey(r.name) === key);
                const isNonHuntable = NON_HUNTABLE_SPECIES_IDS.has(c.pokeId) || c.catchable === false || c.wild === false || c.disabled === true;
                if (isNonHuntable && !routeMatch) continue;

                pokemonMap.set(key, {
                    name: c.name,
                    level: routeMatch?.level || c.level || 1,
                    pokeId: c.pokeId || c.id || 0,
                    type1: c.type1 || '',
                    type2: c.type2 || '',
                    area: routeMatch?.area || 'map'
                });
            }
        } else {
            // Fallback para rotas do mapa se criaturas ainda não responderam
            routes.forEach(r => {
                if (!r.name) return;
                const key = getNormalizedKey(r.name);
                const rawKey = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                pokemonMap.set(key, {
                    name: NAME_MAP[rawKey] || r.name,
                    level: r.level || 1,
                    pokeId: 0,
                    type1: '',
                    type2: '',
                    area: r.area || 'map'
                });
            });
        }

        // 2. Garante que qualquer rota vinda do DOM/API também esteja presente e atualize dados
        routes.forEach(r => {
            if (!r.name) return;
            const key = getNormalizedKey(r.name);
            const creature = creatures.find(c => getNormalizedKey(c.name) === key);
            const rawKey = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const correctName = creature?.name || NAME_MAP[rawKey] || r.name;

            if (!pokemonMap.has(key)) {
                pokemonMap.set(key, {
                    name: correctName,
                    level: r.level || 1,
                    pokeId: creature?.pokeId || creature?.id || 0,
                    type1: creature?.type1 || '',
                    type2: creature?.type2 || '',
                    area: r.area || 'map'
                });
            } else {
                const existing = pokemonMap.get(key);
                if (r.level) existing.level = r.level;
                if (r.area) existing.area = r.area;
                if (creature && (!existing.pokeId || existing.pokeId === 0)) {
                    existing.pokeId = creature.pokeId || creature.id || 0;
                    existing.name = creature.name;
                    existing.type1 = creature.type1 || '';
                    existing.type2 = creature.type2 || '';
                }
            }
        });

        for (const city of CITY_SLUGS) pokemonMap.delete(city);
        let pokemonArray = [...pokemonMap.values()];
        if (filterWeakOnly && leaderTypes.length > 0) {
            pokemonArray = pokemonArray.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
        }
        if (filterShinyAvail && shinyAvailable.size > 0) {
            pokemonArray = pokemonArray.filter(p => shinyAvailable.has(p.name.toLowerCase()));
        }
        if (filter) {
            const f = filter.toLowerCase();
            pokemonArray = pokemonArray.filter(p => p.name.toLowerCase().includes(f) || String(p.pokeId).includes(f));
        }
        pokemonArray.sort((a, b) => a.pokeId - b.pokeId || a.level - b.level);
        return pokemonArray;
    }

    function renderPokemonList(filter) {
        scanDOMRoutes();
        const list = document.getElementById('piw-pokemon-list');
        const pageInfo = document.getElementById('piw-page-info');
        const prevBtn = document.getElementById('piw-prev-page');
        const nextBtn = document.getElementById('piw-next-page');
        if (!list) return;

        let pokemonArray = getFilteredPokemonList(filter);

        // Ordena por nível
        pokemonArray.sort((a, b) => a.level - b.level);

        // Paginação
        const totalPages = Math.max(1, Math.ceil(pokemonArray.length / ITEMS_PER_PAGE));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;
        const startIdx = (currentPage - 1) * ITEMS_PER_PAGE;
        const pageItems = pokemonArray.slice(startIdx, startIdx + ITEMS_PER_PAGE);

        // Atualiza controles de paginação
        if (pageInfo) pageInfo.textContent = `${currentPage} / ${totalPages}`;
        if (prevBtn) prevBtn.disabled = currentPage <= 1;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

        list.innerHTML = pageItems.map(pokemon => {
            const sel = selectedPokemon.includes(pokemon.name);
            const lvlText = pokemon.level > 0 ? ` <span style="color:#8899aa">Lv.${pokemon.level}</span>` : '';
            const canBeShiny = shinyAvailable.has(pokemon.name.toLowerCase());
            const shinyIcon = canBeShiny ? ` <span class="piw-shiny-icon">✨</span>` : '';
            return `<div class="piw-pokemon-item${sel?' selected':''}" data-name="${pokemon.name}">
                <span class="piw-check">${sel ? '✓' : ''}</span>
                ${pokemon.name}${lvlText}${shinyIcon}
                <button class="piw-hunt-now" data-name="${pokemon.name}" title="Caçar agora">⚔</button>
            </div>`;
        }).join('');

        list.querySelectorAll('.piw-pokemon-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.piw-hunt-now')) return;
                const name = item.dataset.name;
                if (selectedPokemon.includes(name)) {
                    selectedPokemon = selectedPokemon.filter(n => n !== name);
                } else {
                    selectedPokemon.push(name);
                }
                GM_setValue('piw_selectedPokemon', selectedPokemon);
                renderSelectedTags();
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            });
        });
        list.querySelectorAll('.piw-hunt-now').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = btn.dataset.name;
                const overlayEl = document.querySelector('.piw-modal-overlay');
                if (overlayEl) { pokedexModalTypeFilter = ''; pokedexModalFilter = ''; pokedexModalWeakOnly = false; overlayEl.remove(); }
                navigateToPokemon(name);
            });
        });
    }

    // ========== POKEDEX MODAL ==========
    let pokedexModalFilter = '';
    let pokedexModalTypeFilter = '';
    let pokedexModalShinyOnly = false;
    let pokedexModalWeakOnly = false;

    function getPokemonImageUrl(pokeId, name, animated = false) {
        if (!pokeId || pokeId <= 0) {
            if (name && creatures && creatures.length > 0) {
                const c = creatures.find(cr => cr.name?.toLowerCase() === name.toLowerCase());
                if (c && c.pokeId > 0) pokeId = c.pokeId;
            }
        }
        if (!pokeId || pokeId <= 0) return '';
        if (pokeId < 10000) {
            if (animated && pokeId <= 649) {
                return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${pokeId}.gif`;
            }
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeId}.png`;
        }
        let bestBase = null;
        for (const c of creatures) {
            if (c.pokeId >= 10000 || !c.name) continue;
            if (name?.toLowerCase().includes(c.name.toLowerCase())) {
                if (!bestBase || c.name.length > bestBase.name.length) bestBase = c;
            }
        }
        if (bestBase) {
            if (animated && bestBase.pokeId <= 649) {
                return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${bestBase.pokeId}.gif`;
            }
            return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${bestBase.pokeId}.png`;
        }
        return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokeId}.png`;
    }

    function openPokedexModal() {
        if (document.getElementById('piw-pokedex-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'piw-pokedex-overlay';
        overlay.className = 'piw-modal-overlay';
        overlay.innerHTML = `
            <div class="piw-modal">
                <div class="piw-modal-header">
                    <h3>Selecionar Pokémon</h3>
                    <button class="piw-modal-close" id="piw-pokedex-close">&times;</button>
                </div>
                <div class="piw-modal-toolbar">
                    <input type="text" id="piw-pokedex-search" placeholder="Buscar por nome ou número..." value="${pokedexModalFilter}">
                    <select id="piw-pokedex-type-filter">
                        <option value="">Todos os tipos</option>
                        ${Object.keys(TYPE_COLORS).sort().map(t => `<option value="${t}" ${pokedexModalTypeFilter===t?'selected':''}>${t[0]+t.slice(1).toLowerCase()}</option>`).join('')}
                    </select>
                    <label class="piw-check"><input type="checkbox" id="piw-pokedex-shiny" ${pokedexModalShinyOnly?'checked':''}> Shiny</label>
                    <label class="piw-check"><input type="checkbox" id="piw-pokedex-weak" ${pokedexModalWeakOnly?'checked':''}> Fraco contra líder</label>
                    <span class="piw-modal-count" id="piw-pokedex-count"></span>
                </div>
                <div id="piw-type-hint" style="display:none;padding:8px 20px;font-size:12px;border-bottom:1px solid #1e2433"></div>
                <div class="piw-modal-body">
                    <div class="piw-pokedex-grid" id="piw-pokedex-grid"></div>
                </div>
                <div class="piw-modal-footer">
                    <div class="piw-btns-row">
                        <button class="piw-btn" id="piw-pokedex-select-all">Selecionar todos</button>
                        <button class="piw-btn" id="piw-pokedex-clear-all">Limpar tudo</button>
                    </div>
                    <span class="piw-selected-info" id="piw-pokedex-selected-info"></span>
                    <button class="piw-btn piw-btn-apply" id="piw-pokedex-apply">Aplicar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        const modal = overlay.querySelector('.piw-modal');
        const modalHeader = modal.querySelector('.piw-modal-header');

        bringToFront(overlay);
        makeBringableToFront(overlay);
        makeBringableToFront(modal);
        applyOpacityAll();

        const savedModalSize = GM_getValue('piw_modalSize', null);
        if (savedModalSize && savedModalSize.w && savedModalSize.h) {
            modal.style.width  = savedModalSize.w + 'px';
            modal.style.height = savedModalSize.h + 'px';
        }
        const savedModalPos = GM_getValue('piw_modalPos', null);
        if (savedModalPos) {
            const mpl = parseFloat(savedModalPos.left);
            const mpt = parseFloat(savedModalPos.top);
            if (!isNaN(mpl)) { modal.style.left = mpl + 'px'; modal.style.right = 'auto'; }
            if (!isNaN(mpt)) { modal.style.top  = mpt + 'px'; modal.style.bottom = 'auto'; }
        } else if (savedModalSize && savedModalSize.w && savedModalSize.h) {
            // Centraliza baseado no tamanho salvo se não houver posição salva
            modal.style.left = `calc(50vw - ${savedModalSize.w / 2}px)`;
            modal.style.top  = `calc(50vh - ${savedModalSize.h / 2}px)`;
        }

        makeDraggable(modal, modalHeader, 'piw_modalPos');

        const modalResize = document.createElement('div');
        modalResize.className = 'piw-modal-resize';
        modal.appendChild(modalResize);
        makeResizable(modal, modalResize, 'piw_modalSize', 500, 400);

        const grid = document.getElementById('piw-pokedex-grid');
        const searchInput = document.getElementById('piw-pokedex-search');
        const typeFilter = document.getElementById('piw-pokedex-type-filter');
        const shinyCheck = document.getElementById('piw-pokedex-shiny');
        const countEl = document.getElementById('piw-pokedex-count');
        const infoEl = document.getElementById('piw-pokedex-selected-info');

        modal.style.opacity = panel.style.opacity;

        let tempSelected = [...selectedPokemon];

        function renderPokedex() {
            const filter = searchInput.value.toLowerCase();
            const typeF = typeFilter.value;
            const shinyOnly = shinyCheck.checked;

            let pokemonArray = getFilteredPokemonList('');

            if (filter) {
                pokemonArray = pokemonArray.filter(p =>
                    p.name.toLowerCase().includes(filter) || String(p.pokeId).includes(filter)
                );
            }
            if (typeF) {
                pokemonArray = pokemonArray.filter(p => p.type1 === typeF || p.type2 === typeF);
            }
            if (shinyOnly) {
                pokemonArray = pokemonArray.filter(p => shinyAvailable.has(p.name.toLowerCase()));
            }
            if (pokedexModalWeakOnly && leaderTypes.length > 0) {
                pokemonArray = pokemonArray.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
            }

            countEl.textContent = `${pokemonArray.length} pokemon(s)`;

            grid.innerHTML = pokemonArray.map(p => {
                const sel = tempSelected.includes(p.name);
                const img = getPokemonImageUrl(p.pokeId, p.name);
                const canShiny = shinyAvailable.has(p.name.toLowerCase());
                const types = [p.type1, p.type2].filter(Boolean);
                return `<div class="piw-poke-card${sel?' selected':''}" data-name="${p.name}">
                    <div class="piw-poke-check">✓</div>
                    ${canShiny ? '<div class="piw-poke-shiny">✨</div>' : ''}
                    <button class="piw-hunt-card-btn" data-name="${p.name}" title="Caçar agora">⚔</button>
                    <img class="piw-poke-img" src="${img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">
                    <div class="piw-poke-num">#${String(p.pokeId).padStart(3,'0')}</div>
                    <div class="piw-poke-name" title="${p.name}">${p.name}</div>
                    <div class="piw-poke-level">Lv.${p.level}</div>
                    <div class="piw-poke-types">
                        ${types.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#888'}">${t}</span>`).join('')}
                    </div>
                </div>`;
            }).join('');

            infoEl.textContent = `${tempSelected.length} selecionado(s)`;

            grid.querySelectorAll('.piw-poke-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('.piw-hunt-card-btn')) return;
                    const name = card.dataset.name;
                    if (tempSelected.includes(name)) {
                        tempSelected = tempSelected.filter(n => n !== name);
                    } else {
                        tempSelected.push(name);
                    }
                    card.classList.toggle('selected');
                    infoEl.textContent = `${tempSelected.length} selecionado(s)`;
                });
            });
            grid.querySelectorAll('.piw-hunt-card-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const name = btn.dataset.name;
                    pokedexModalTypeFilter = ''; pokedexModalFilter = ''; pokedexModalWeakOnly = false;
                    overlay.remove();
                    navigateToPokemon(name);
                });
            });
        }

        searchInput.addEventListener('input', () => { pokedexModalFilter = searchInput.value; renderPokedex(); });
        typeFilter.addEventListener('change', () => {
            pokedexModalTypeFilter = typeFilter.value;
            renderPokedex();
            const hintEl = document.getElementById('piw-type-hint');
            if (hintEl) {
                if (typeFilter.value) {
                    const weakTo = TYPE_WEAK_TO[typeFilter.value] || [];
                    const superEff = TYPE_SUPER_EFFECTIVE[typeFilter.value] || [];
                    let html = `<span style="color:#f87171;font-weight:600">⚔ Fraco contra:</span> `;
                    html += weakTo.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'}">${t}</span>`).join(' ');
                    html += `<br><span style="color:#4ade80;font-weight:600">🛡 Resistente a:</span> `;
                    html += superEff.map(t => `<span class="piw-type-badge" style="background:${TYPE_COLORS[t]||'#555'}">${t}</span>`).join(' ');
                    hintEl.innerHTML = html;
                    hintEl.style.display = 'block';
                } else {
                    hintEl.style.display = 'none';
                }
            }
        });
        shinyCheck.addEventListener('change', () => { pokedexModalShinyOnly = shinyCheck.checked; renderPokedex(); });
        const weakCheck = document.getElementById('piw-pokedex-weak');
        weakCheck.addEventListener('change', () => { pokedexModalWeakOnly = weakCheck.checked; renderPokedex(); });

        document.getElementById('piw-pokedex-select-all').addEventListener('click', () => {
            const filter = searchInput.value.toLowerCase();
            const typeF = typeFilter.value;
            const shinyOnly = shinyCheck.checked;
            let list = getFilteredPokemonList('');
            if (filter) list = list.filter(p => p.name.toLowerCase().includes(filter) || String(p.pokeId).includes(filter));
            if (typeF) list = list.filter(p => p.type1 === typeF || p.type2 === typeF);
            if (shinyOnly) list = list.filter(p => shinyAvailable.has(p.name.toLowerCase()));
            if (pokedexModalWeakOnly && leaderTypes.length > 0) list = list.filter(p => isWeakAgainstLeader(p.name, leaderTypes));
            tempSelected = [...new Set([...tempSelected, ...list.map(p => p.name)])];
            renderPokedex();
        });

        document.getElementById('piw-pokedex-clear-all').addEventListener('click', () => {
            tempSelected = [];
            renderPokedex();
        });

        document.getElementById('piw-pokedex-apply').addEventListener('click', () => {
            selectedPokemon = [...tempSelected];
            GM_setValue('piw_selectedPokemon', selectedPokemon);
            renderSelectedTags();
            renderPokemonList(document.getElementById('piw-search')?.value || '');
            pokedexModalTypeFilter = '';
            pokedexModalFilter = '';
            pokedexModalWeakOnly = false;
            overlay.remove();
        });

        document.getElementById('piw-pokedex-close').addEventListener('click', () => { pokedexModalTypeFilter = ''; pokedexModalFilter = ''; pokedexModalWeakOnly = false; overlay.remove(); });

        renderPokedex();
    }

    // Marca pokémons que têm shiny usando a tabela fixa
    function markShinyAvailable() {
        for (const c of creatures) {
            if (SHINY_SPECIES_IDS.has(c.pokeId)) {
                shinyAvailable.add(c.name.toLowerCase());
            }
        }
        GM_log('[AutoHunt] ✨ Shiny disponíveis:', shinyAvailable.size);
        renderPokemonList(document.getElementById('piw-search')?.value || '');
    }

    // ========== BUSCAR DADOS DO JOGO ==========
    async function fetchGameData() {
        try {
            // Busca creatures.json
            const creaturesResp = await fetch('/game/creatures.json');
            if (creaturesResp.ok) {
                const data = await creaturesResp.json();
                creatures = data.creatures || [];
                GM_log('[AutoHunt] Creatures carregados:', creatures.length);
                // Marca shiny disponíveis após carregar creatures
                markShinyAvailable();
            }
        } catch(e) {
            GM_log('[AutoHunt] Erro ao buscar creatures.json:', e);
        }

        // Busca rotas de múltiplos endpoints do mapa (Kanto, Outland, etc.)
        const mapEndpoints = [
            '/api/game/map-markers',
            '/api/game/outland-markers',
            '/api/game/outland',
            '/api/game/outlands',
            '/api/game/map-markers?area=outland',
            '/game/outland.json',
            '/game/hunts.json'
        ];

        const seenSlugs = new Set(routes.map(r => r.slug || r.name));

        for (const ep of mapEndpoints) {
            try {
                const markersResp = await fetch(ep);
                if (markersResp.ok) {
                    const data = await markersResp.json();
                    let rawHunts = [];
                    if (Array.isArray(data)) {
                        rawHunts = data;
                    } else if (typeof data === 'object' && data !== null) {
                        for (const [key, val] of Object.entries(data)) {
                            if (Array.isArray(val)) {
                                const isOutlandKey = key.toLowerCase().includes('outland') || ep.includes('outland');
                                val.forEach(item => {
                                    if (item && typeof item === 'object') {
                                        rawHunts.push({
                                            ...item,
                                            area: item.area || (isOutlandKey ? 'outland' : undefined)
                                        });
                                    }
                                });
                            }
                        }
                    }
                    for (const h of rawHunts) {
                        if (h && h.name && h.slug !== 'cerulean') {
                            const key = (h.slug || h.name).toLowerCase().replace(/[^a-z0-9]/g, '');
                            if (!seenSlugs.has(key)) {
                                seenSlugs.add(key);
                                routes.push(h);
                            }
                        }
                    }
                }
            } catch(e) {}
        }
        GM_log('[AutoHunt] Rotas totais (incluindo Outland) carregadas:', routes.length);
    }

    // Escaneia marcadores de rotas/outland direto do DOM do jogo
    function scanDOMRoutes() {
        const markers = document.querySelectorAll('button.hunt-marker');
        let added = 0;
        for (const m of markers) {
            const nameEl = m.querySelector('.hunt-name');
            const lvEl = m.querySelector('.hunt-lv, .hunt-level, [class*="lv"], [class*="level"]');
            if (nameEl) {
                const name = nameEl.textContent.trim();
                if (name && name !== 'Cerulean') {
                    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (!routes.some(r => r.name?.toLowerCase() === name.toLowerCase())) {
                        const lvMatch = (lvEl?.textContent || '').match(/\d+/);
                        const isOutland = document.querySelector('button.map-area.active')?.textContent?.toLowerCase().includes('outland') || false;
                        routes.push({
                            name: name,
                            slug: key,
                            level: lvMatch ? Number(lvMatch[0]) : 1,
                            area: isOutland ? 'outland' : undefined
                        });
                        added++;
                    }
                }
            }
        }
        if (added > 0) {
            GM_log('[AutoHunt] Novas rotas/Outland detectadas via DOM:', added);
        }
    }

    // ========== DETECTAR ROTA ATUAL ==========
    function detectRoute() {
        scanDOMRoutes();
        // Procura no DOM elementos que contenham o nome da rota
        const candidates = document.querySelectorAll(
            '[class*="route"] a, [class*="location"], [class*="area"], .piw-route-src'
        );
        for (const el of candidates) {
            const t = (el.textContent || '').trim();
            if (t && t.length < 40 && !/loading/i.test(t) && !/menu/i.test(t)) {
                currentRoute = t.split('(')[0].trim();
                return currentRoute;
            }
        }
        // Detecta cidade pelo mapa se slug não foi setado pelo WebSocket
        if (!currentSlug) {
            const mapMarkers = document.querySelectorAll('.map-marker, .city-marker, button[data-city]');
            for (const m of mapMarkers) {
                const citySlug = m.getAttribute('data-city') || (m.textContent || '').trim().toLowerCase();
                if (CITY_SLUGS.has(citySlug)) {
                    currentSlug = citySlug;
                    GM_log('[AutoHunt] Cidade detectada via DOM:', citySlug);
                    syncUI();
                    return currentRoute;
                }
            }
            // Checa se URL/estado indica cidade
            if (window.location.hash && /city|town|village/.test(window.location.hash)) {
                for (const city of CITY_SLUGS) {
                    if (window.location.hash.toLowerCase().includes(city)) {
                        currentSlug = city;
                        GM_log('[AutoHunt] Cidade detectada via URL:', city);
                        syncUI();
                        return currentRoute;
                    }
                }
            }
        }
        // Fallback: tenta ler do estado do React (se exposto)
        if (window.__gameState?.currentRoute) {
            currentRoute = window.__gameState.currentRoute;
        }
        return currentRoute;
    }

    // ========== OUVIR EVENTO PW-KILL ==========
    window.addEventListener('pw-kill', () => {
        if (!enabled || isCity() || busy) return;
        killCount++;
        GM_log('[AutoHunt] Kill! Total:', killCount);
        const killTgt = GM_getValue('piw_killTarget', 100);
        const capTgt = GM_getValue('piw_captureTarget', 1);
        if (currentSlug) {
            const slugLower = currentSlug.toLowerCase();
            const matchIdx = selectedPokemon.findIndex(n => n.toLowerCase().replace(/\s+/g, '-') === slugLower || n.toLowerCase() === slugLower);
            if (matchIdx !== -1) {
                const killKey = 'piw_kills_' + slugLower;
                const prev = GM_getValue(killKey, 0);
                GM_setValue(killKey, prev + 1);
                const capKey = 'piw_captures_' + slugLower;
                const totalCaps = GM_getValue(capKey, 0);
                if ((prev + 1) >= killTgt && totalCaps >= capTgt) {
                    if (!loopMode) {
                        selectedPokemon.splice(matchIdx, 1);
                        GM_setValue('piw_selectedPokemon', selectedPokemon);
                        renderSelectedTags();
                        renderPokemonList(document.getElementById('piw-search')?.value || '');
                        GM_log('[AutoHunt] ' + slugLower + ' atingiu os 2 alvos! Removido.');
                    } else {
                        GM_log('[AutoHunt] ' + slugLower + ' atingiu os 2 alvos! (loop ativo, mantido na lista)');
                    }
                }
            }
        }
        syncUI();
        checkSwitch();
    });

    // ========== CHECK SWITCH ==========
    function checkSwitch() {
        if (isCity()) return;
        if (shinyOnlyMode) return;
        const killTarget = GM_getValue('piw_killTarget', 100);
        const capTarget = GM_getValue('piw_captureTarget', 1);
        let shouldSwitch = false;
        if (exitOnKills && exitOnCaptures) {
            shouldSwitch = (killCount >= killTarget || captureCount >= capTarget);
        } else if (exitOnKills) {
            shouldSwitch = (killCount >= killTarget);
        } else if (exitOnCaptures) {
            shouldSwitch = (captureCount >= capTarget);
        } else {
            shouldSwitch = (killCount >= killTarget && captureCount >= capTarget);
        }
        if (shouldSwitch && !busy) {
            doSwitch();
        }
    }

    // Polling para detectar rota
    setInterval(() => { detectRoute(); syncUI(); }, 3000);

    // ========== WEBSOCKET INTERCEPTION ==========
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function(data) {
        try {
            const parsed = JSON.parse(data);
            if (parsed && parsed.type) {
                if (!socket) {
                    socket = this;
                    setTimeout(() => {
                        try { socket.send(JSON.stringify({ type: 'pokes-get' })); } catch(e){}
                    }, 400);
                } else {
                    socket = this;
                }
            }
        } catch(e) {}
        return origSend.call(this, data);
    };

    // Intercepta WebSocket para detectar capturas, slug da rota e pokémon líder
    const origOnMessage = Object.getOwnPropertyDescriptor(WebSocket.prototype, 'onmessage');
    Object.defineProperty(WebSocket.prototype, 'onmessage', {
        get: function() { return origOnMessage.get.call(this); },
        set: function(handler) {
            const wrappedHandler = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    // Detecta slug da rota (field-init)
                    if (data && data.type === 'field-init' && data.slug) {
                        const wasCity = isCity();
                        currentSlug = data.slug;
                        currentRoute = data.name || data.slug;
                        // Se entrou em cidade, reseta contadores
                        if (!wasCity && isCity()) {
                            killCount = 0;
                            captureCount = 0;
                            GM_log('[AutoHunt] Entrou em cidade, contadores resetados.');
                        }
                        GM_log('[AutoHunt] Rota detectada:', currentRoute, '(' + currentSlug + ')');
                        syncUI();
                    }
                    // Detecta captura bem-sucedida
                    if (data && data.type === 'catch-result') {
                        if (data.success === true && enabled) {
                            if (!busy) {
                                captureCount++;
                                GM_log('[AutoHunt] Captura! Total:', captureCount);
                                if (data.speciesName) {
                                    const nameLower = data.speciesName.toLowerCase();
                                    const matchIdx = selectedPokemon.findIndex(n => n.toLowerCase() === nameLower);
                                    if (matchIdx !== -1) {
                                        const killTgt = GM_getValue('piw_killTarget', 100);
                                        const capTgt = GM_getValue('piw_captureTarget', 1);
                                        const capKey = 'piw_captures_' + nameLower;
                                        const prevCap = GM_getValue(capKey, 0);
                                        GM_setValue(capKey, prevCap + 1);
                                        const killKey = 'piw_kills_' + nameLower;
                                        const totalKills = GM_getValue(killKey, 0);
                                        if ((prevCap + 1) >= capTgt && totalKills >= killTgt) {
                                            if (!loopMode) {
                                                selectedPokemon.splice(matchIdx, 1);
                                                GM_setValue('piw_selectedPokemon', selectedPokemon);
                                                renderSelectedTags();
                                                renderPokemonList(document.getElementById('piw-search')?.value || '');
                                                GM_log('[AutoHunt] ' + nameLower + ' atingiu os 2 alvos! Removido.');
                                            } else {
                                                GM_log('[AutoHunt] ' + nameLower + ' atingiu os 2 alvos! (loop ativo, mantido na lista)');
                                            }
                                        }
                                    }
                                }
                                syncUI();
                                checkSwitch();
                            }
                        } else {
                            GM_log('[AutoHunt] Captura falhou');
                        }
                    }
                    if (data) {
                        const hit = extractCombatHit(data);
                        if (hit) {
                            observedMovesMap.set(hit.name.toLowerCase(), hit);
                            if (movesWindowVisible) renderMovesWindow();
                        }
                    }
                    // Detecta lista de pokémons (líder + shiny)
                    if (data && data.type === 'pokes' && data.list) {
                        detectShinyFromPokes(data.list);
                        updateLeader(data.list);
                    }
                } catch(e) {
                    GM_log('[AutoHunt] Erro no WS onmessage:', e);
                }
                if (handler) handler.call(this, event);
            };
            origOnMessage.set.call(this, wrappedHandler);
        }
    });

    setInterval(() => {
        if (leaderName) {
            const domLevel = getLeaderLevelFromDOM();
            if (domLevel !== null && domLevel !== leaderLevel) {
                leaderLevel = domLevel;
                syncUI();
                GM_log('[AutoHunt] Level atualizado via DOM:', leaderLevel);
            }
        } else {
            // Tenta detectar líder via DOM se ainda não tiver detectado
            const domLeader = getLeaderFromDOM();
            if (domLeader) {
                leaderName = domLeader.name;
                leaderLevel = domLeader.level;
                if (creatures && creatures.length > 0) {
                    const c = creatures.find(cr => cr.name?.toLowerCase() === leaderName.toLowerCase());
                    if (c) {
                        leaderPokeId = c.pokeId || 0;
                        leaderTypes = [c.type1, c.type2].filter(Boolean);
                    }
                }
                syncUI();
            }
        }
    }, 2000);

    // Detecta novos shinies comparando a lista anterior
    function detectShinyFromPokes(pokeList) {
        const currentShinies = pokeList.filter(p => p.shiny);
        const newShinyIds = currentShinies
            .filter(p => !lastPokesList.some(old => old.id === p.id && old.shiny))
            .map(p => p.id);

        if (newShinyIds.length > 0) {
            for (const shiny of currentShinies.filter(p => newShinyIds.includes(p.id))) {
                shinyCount++;
                GM_log('[AutoHunt] ✨ NOVO SHINY CAPTURADO!', shiny.name, '(total:', shinyCount + ')');
            }
            syncUI();
            // Se está no modo shiny-only, reseta contadores e troca
            if (shinyOnlyMode && !busy) {
                GM_log('[AutoHunt] Modo shiny-only: trocando de rota...');
                doSwitch();
            }
        }

        // Atualiza a lista anterior
        lastPokesList = pokeList.map(p => ({ id: p.id, shiny: p.shiny, name: p.name }));

        // Atualiza contagem total de shinies
        const totalShinies = currentShinies.length;
        if (totalShinies !== shinyCount) {
            shinyCount = totalShinies;
            syncUI();
        }
    }

    function getLeaderFromDOM() {
        const partyMon = document.querySelectorAll(".phud-party .phud-mon");
        for (const mon of partyMon) {
            const isActive = mon.classList.contains("active") || /\(ativo\)/i.test(mon.title || "");
            const nameEl = mon.querySelector(".phud-name");
            const lvEl = mon.querySelector(".phud-lv");
            if (nameEl) {
                const name = nameEl.textContent?.trim() || "";
                const lvMatch = (lvEl?.textContent || "").match(/\d+/);
                const level = lvMatch ? Number(lvMatch[0]) : 1;
                if (name && (isActive || partyMon.length === 1)) return { name, level };
            }
        }
        if (partyMon.length > 0) {
            const nameEl = partyMon[0].querySelector(".phud-name");
            const lvEl = partyMon[0].querySelector(".phud-lv");
            if (nameEl) {
                const name = nameEl.textContent?.trim() || "";
                const lvMatch = (lvEl?.textContent || "").match(/\d+/);
                const level = lvMatch ? Number(lvMatch[0]) : 1;
                if (name) return { name, level };
            }
        }
        const generalName = document.querySelector(".phud-name, [class*='party-name'], [class*='mon-name']");
        if (generalName) {
            const name = generalName.textContent?.trim() || "";
            if (name) return { name, level: 1 };
        }
        return null;
    }

    function getLeaderLevelFromDOM() {
        const partyMon = document.querySelectorAll(".phud-party .phud-mon");
        for (const mon of partyMon) {
            const isActive = mon.classList.contains("active") || /\(ativo\)/i.test(mon.title || "");
            if (!isActive) continue;
            const nameEl = mon.querySelector(".phud-name");
            const lvEl = mon.querySelector(".phud-lv");
            if (!nameEl || !lvEl) continue;
            const name = nameEl.textContent?.trim() || "";
            const lvMatch = (lvEl.textContent || "").match(/\d+/);
            const level = lvMatch ? Number(lvMatch[0]) : NaN;
            if (Number.isFinite(level) && (!leaderName || name.toLowerCase() === leaderName.toLowerCase())) {
                return level;
            }
        }
        return null;
    }

    // Atualiza o pokémon líder a partir da lista
    function updateLeader(pokeList) {
        const team = pokeList.filter(p => p.team).sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
        const leader = team.find(p => p.leader) ?? team[0];
        if (leader) {
            currentLeaderData = leader;
            const newName = leader.name;
            const newTypes = [leader.type1, leader.type2].filter(Boolean);
            let newLevel = leader.level || leader.lvl || leader.pokemonLevel || leader.currentLevel || 0;
            const domLevel = getLeaderLevelFromDOM();
            if (domLevel !== null) newLevel = domLevel;
            const newPokeId = leader.pokeId || (() => {
                const c = creatures.find(c => c.name?.toLowerCase() === newName.toLowerCase());
                return c?.pokeId || 0;
            })();
            const debugInfo = `name:${leader.name} lv:${leader.level} keys:${Object.keys(leader).join(',')}`;
            GM_log('[AutoHunt] Leader raw:', debugInfo);
            const changed = newName !== leaderName || JSON.stringify(newTypes) !== JSON.stringify(leaderTypes) || newLevel !== leaderLevel;
            leaderName = newName;
            leaderTypes = newTypes;
            leaderPokeId = newPokeId;
            leaderLevel = newLevel;
            syncUI();
            if (changed) {
                GM_log('[AutoHunt] Líder detectado:', leaderName, '(' + leaderTypes.join('/') + ') Lv', leaderLevel);
                renderPokemonList(document.getElementById('piw-search')?.value || '');
            }
        }
    }

    // ========== NAVEGAR ATÉ POKÉMON ==========
    async function navigateToPokemon(pokemonName) {
        try {
            const mapBtn = document.querySelector('button.dock-btn[data-guide="dock-map"]');
            if (!mapBtn) return;
            mapBtn.click();
            await sleep(800);
            const mapOverlay = document.querySelector('.map-overlay');
            if (!mapOverlay) return;
            await sleep(400);
            const routeData = routes.find(r => r.name?.toLowerCase() === pokemonName.toLowerCase());
            if (routeData && routeData.area) {
                const areaTabs = document.querySelectorAll('button.map-area');
                for (const tab of areaTabs) {
                    const tabText = tab.textContent?.toLowerCase() || '';
                    const areaName = routeData.area.toLowerCase();
                    if (tabText.includes(areaName) || (tabText.includes('outland') && areaName === 'outland')) {
                        tab.click();
                        await sleep(600);
                        break;
                    }
                }
            }
            const markers = document.querySelectorAll('button.hunt-marker');
            for (const marker of markers) {
                const nameEl = marker.querySelector('.hunt-name');
                if (!nameEl) continue;
                const name = nameEl.textContent.trim();
                if (name.toLowerCase() === pokemonName.toLowerCase()) {
                    marker.click();
                    return;
                }
            }
        } catch(e) { GM_log('[AutoHunt] navigateToPokemon error:', e); }
    }

    // ========== TROCAR DE ROTA ==========
    async function doSwitch() {
        busy = true;
        syncUI();
        GM_log('[AutoHunt] Alvo atingido! Procurando nova rota...');

        try {
            // 1) Abre o mapa
            const mapBtn = document.querySelector('button.dock-btn[data-guide="dock-map"]');
            if (!mapBtn) {
                GM_log('[AutoHunt] Botão do mapa não encontrado');
                busy = false;
                return;
            }
            mapBtn.click();
            await sleep(800);

            // 2) Espera o modal do mapa aparecer
            const mapOverlay = document.querySelector('.map-overlay');
            if (!mapOverlay) {
                GM_log('[AutoHunt] Mapa não abriu');
                busy = false;
                return;
            }
            await sleep(400);

            let found = false;

            // Se tem pokémons selecionados, procura rotas com esses pokémons
            if (selectedPokemon.length > 0) {
                // Procura pokémons selecionados que estão no mapa
                for (const pokemon of selectedPokemon) {
                    if (found) break;

                    // Busca a rota nos dados do mapa se existir
                    const routeData = routes.find(r => r.name?.toLowerCase() === pokemon.toLowerCase());

                    // Se tem área conhecida, clica na aba do mapa correspondente
                    if (routeData && routeData.area) {
                        const areaTabs = document.querySelectorAll('button.map-area');
                        for (const tab of areaTabs) {
                            const tabText = tab.textContent?.toLowerCase() || '';
                            const areaName = routeData.area.toLowerCase();
                            if (tabText.includes(areaName) || (tabText.includes('outland') && areaName === 'outland')) {
                                GM_log('[AutoHunt] Clicando aba:', tab.textContent.trim());
                                tab.click();
                                await sleep(600);
                                break;
                            }
                        }
                    }

                    // Tenta encontrar o marcador no mapa visível
                    let targetMarker = null;
                    let markers = document.querySelectorAll('button.hunt-marker');
                    for (const marker of markers) {
                        const nameEl = marker.querySelector('.hunt-name');
                        if (!nameEl) continue;
                        const name = nameEl.textContent.trim();
                        if (name.toLowerCase() === pokemon.toLowerCase() && !marker.classList.contains('here')) {
                            targetMarker = marker;
                            break;
                        }
                    }

                    // Se não achou na aba atual, varre as abas do mapa (ex: Outland / Kanto)
                    if (!targetMarker) {
                        const areaTabs = document.querySelectorAll('button.map-area');
                        for (const tab of areaTabs) {
                            if (tab.classList.contains('active')) continue;
                            tab.click();
                            await sleep(500);
                            markers = document.querySelectorAll('button.hunt-marker');
                            for (const marker of markers) {
                                const nameEl = marker.querySelector('.hunt-name');
                                if (!nameEl) continue;
                                const name = nameEl.textContent.trim();
                                if (name.toLowerCase() === pokemon.toLowerCase() && !marker.classList.contains('here')) {
                                    targetMarker = marker;
                                    break;
                                }
                            }
                            if (targetMarker) break;
                        }
                    }

                    if (targetMarker) {
                        // Se mudou de pokémon, zera contadores
                        if (huntingPokemon !== pokemon) {
                            killCount = 0;
                            captureCount = 0;
                            huntingPokemon = pokemon;
                            const slug = pokemon.toLowerCase().replace(/\s+/g, '-');
                            GM_setValue('piw_kills_' + slug, 0);
                            GM_setValue('piw_captures_' + slug, 0);
                            GM_log('[AutoHunt] Novo pokémon:', pokemon, '- contadores resetados.');
                        }
                        GM_log('[AutoHunt] Clicando rota:', pokemon);
                        targetMarker.click();
                        currentRoute = pokemon;
                        found = true;
                        break;
                    }
                }
            } else {
                GM_log('[AutoHunt] Lista vazia, voltando pra cidade...');
                const cityBtn = document.querySelector('button.dock-btn[data-guide="dock-home"], [class*="home"], [class*="city"]');
                if (cityBtn) cityBtn.click();
                enabled = false;
                GM_setValue('piw_enabled', false);
                syncUI();
                return;
            }

            // Se não encontrou nenhum pokémon selecionado, pega qualquer rota diferente da atual
            if (!found) {
                const markers = document.querySelectorAll('button.hunt-marker');
                for (const marker of markers) {
                    const nameEl = marker.querySelector('.hunt-name');
                    if (!nameEl) continue;
                    const name = nameEl.textContent.trim();
                    if (name && !marker.classList.contains('here')) {
                        GM_log('[AutoHunt] Fallback rota:', name);
                        marker.click();
                        currentRoute = name;
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                GM_log('[AutoHunt] Nenhuma rota encontrada, pausando...');
                enabled = false;
                GM_setValue('piw_enabled', false);
                syncUI();
            }

        } catch(e) {
            GM_log('[AutoHunt] Erro no switch:', e);
        }

        busy = false;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ========== INICIALIZAR ==========
    async function init() {
        const check = setInterval(() => {
            if (document.querySelector('.game-root, .game-canvas-host, [class*="game-"]')) {
                clearInterval(check);
                buildPanel();
                createInfoWindowDOM();
                createMovesWindowDOM();
                syncUI();
                setTimeout(async () => {
                    await fetchGameData();
                    syncUI();
                    renderPokemonList(document.getElementById('piw-search')?.value || '');
                }, 500);
                setTimeout(() => {
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        socket.send(JSON.stringify({ type: 'pokes-get' }));
                    }
                }, 3000);
                GM_log('[Poke Helper] Painel criado');
            }
        }, 300);
    }

    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init);
    else
        init();

    GM_log('[Poke Helper] Carregado v0.75.0.');
})();
