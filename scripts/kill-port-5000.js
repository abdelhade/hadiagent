'use strict';

const { getPidOnPort, killPid, probeAgentHealth, DEFAULT_PORT_MIN, DEFAULT_PORT_MAX } = require('../src/port-utils');

const min = parseInt(process.env.HADI_AGENT_PORT_MIN || String(DEFAULT_PORT_MIN), 10);
const max = parseInt(process.env.HADI_AGENT_PORT_MAX || String(DEFAULT_PORT_MAX), 10);

(async () => {
    let killed = 0;

    for (let port = min; port <= max; port++) {
        const pid = getPidOnPort(port);
        if (!pid) {
            continue;
        }

        const health = await probeAgentHealth(port);
        console.log(`Port ${port} → PID ${pid}${health ? ' (Hadi Agent)' : ''}`);

        if (killPid(pid)) {
            killed++;
        }
    }

    if (killed === 0) {
        console.log(`No listeners on ports ${min}-${max}.`);
    } else {
        console.log(`Terminated ${killed} process(es).`);
    }
})();
