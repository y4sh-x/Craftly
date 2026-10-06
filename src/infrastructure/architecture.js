'use strict';

/**
 * Release architecture contract.
 *
 * This module intentionally contains policy, not fake node functionality.
 * Later node/provisioning phases consume these constants when their real
 * services are introduced.
 */
const architecture = Object.freeze({
  runtime: 'docker',
  virtualMachineRuntime: null,
  panel: Object.freeze({
    httpPortEnv: 'PANEL_PORT',
    defaultHttpPort: 6060,
  }),
  sftp: Object.freeze({
    portEnv: 'SFTP_PORT',
    defaultPort: 2022,
  }),
  allocations: Object.freeze({
    gameStartEnv: 'PORT_GAME_START',
    defaultGameStart: 25565,
    bedrockStartEnv: 'PORT_BEDROCK_START',
    defaultBedrockStart: 19132,
  }),
});

function assertDockerOnly() {
  if (architecture.runtime !== 'docker' || architecture.virtualMachineRuntime !== null) {
    throw new Error('Craftly architecture must remain Docker-only; VM/KVM runtime is not supported.');
  }
  return true;
}

module.exports = { architecture, assertDockerOnly };
