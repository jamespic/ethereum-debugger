const {expect} = require('chai')
const solc = require('solc')
const Web3 = require('web3')
const Ganache = require('ganache-core')
const ethereumDebugger = require('../src/index.js')

describe('Ethereum Debugger', function () {
  describe('makeSourceMapLookup', function () {
    it('extracts source maps from old-style JSON', function () {
      this.timeout(10000)
      var solcJson = solc.compile({sources: {'MyContract.sol': 'contract MyContract {function() payable {}}'}}, 1)
      var sourceMapLookup = ethereumDebugger._makeSourceMapLookup(solcJson)
      expect(sourceMapLookup).to.have.length(4)
      expect(sourceMapLookup[0]).to.have.property('bytecodeRegex')
      expect(sourceMapLookup[0]).to.have.property('sourceMap')
    })
    it('extracts source maps from new-style JSON', function () {
      this.timeout(10000)
      var solcJson = JSON.parse(solc.compileStandard(JSON.stringify({
        language: 'Solidity',
        sources: {
          'MyContract.sol': {
            content: 'contract MyContract {function() payable {}}'
          }
        },
        settings: {
          outputSelection: {
            '*': {
              '*': [
                'evm.bytecode',
                'evm.deployedBytecode'
              ]
            }
          }
        }
      })))
      var sourceMapLookup = ethereumDebugger._makeSourceMapLookup(solcJson)
      expect(sourceMapLookup).to.have.length(4)
      expect(sourceMapLookup[0]).to.have.property('bytecodeRegex')
      expect(sourceMapLookup[0]).to.have.property('sourceMap')
    })
  })
  describe('extractTxInfo', function () {
    it('can link transaction info to old-style JSON', async function() {
      this.timeout(10000)
      var sources = {'MyContract.sol': 'contract MyContract {function() payable {}}'}
      var solcJson = solc.compile({sources}, 1)
      var provider = Ganache.provider()
      var web3 = new Web3(provider)
      var accounts = await web3.eth.getAccounts()
      var bytecode = '0x' + solcJson.contracts['MyContract.sol:MyContract'].bytecode
      var createTx = await web3.eth.sendTransaction({data: bytecode, from: accounts[0], gasLimit: 1000000})
      var callTx = await web3.eth.sendTransaction({from: accounts[0], value: 1, to: createTx.contractAddress})
      var txInfo = await ethereumDebugger._extractTxInfo(callTx.transactionHash, provider, solcJson, sources)
      // Check that at least one of the info hashes has corresponding info
      var matched
      for (let {infoHash} of txInfo.trace) {
        matched = matched || (infoHash in txInfo.contractInfoLookup)
      }
      expect(matched).to.equal(true)
    })
    it('can link transaction info to new-style JSON', async function() {
      this.timeout(10000)
      var solcJson = JSON.parse(solc.compileStandard(JSON.stringify({
        language: 'Solidity',
        sources: {
          'MyContract.sol': {
            content: 'contract MyContract {function() payable {}}'
          }
        },
        settings: {
          outputSelection: {
            '*': {
              '*': [
                'evm.bytecode',
                'evm.deployedBytecode'
              ]
            }
          }
        }
      })))
      var sources = {'MyContract.sol': 'contract MyContract {function() payable {}}'}
      var provider = Ganache.provider()
      var web3 = new Web3(provider)
      var accounts = await web3.eth.getAccounts()
      var bytecode = '0x' + solcJson.contracts['MyContract.sol']['MyContract'].evm.bytecode.object
      var createTx = await web3.eth.sendTransaction({data: bytecode, from: accounts[0], gasLimit: 1000000})
      var callTx = await web3.eth.sendTransaction({from: accounts[0], value: 1, to: createTx.contractAddress})
      var txInfo = await ethereumDebugger._extractTxInfo(callTx.transactionHash, provider, solcJson, sources)
      // Check that at least one of the info hashes has corresponding info
      var matched
      for (let {infoHash} of txInfo.trace) {
        matched = matched || (infoHash in txInfo.contractInfoLookup)
      }
      expect(matched).to.equal(true)
      expect(txInfo.sources).to.have.property('MyContract.sol')
    })
    it('can handle useLiteralContent sources', async function () {
      this.timeout(10000)
      var solcJson = JSON.parse(solc.compileStandard(JSON.stringify({
        language: 'Solidity',
        sources: {
          'MyContract.sol': {
            content: 'import "Imported.sol"; contract MyContract is Imported {function() payable {}}'
          }
        },
        settings: {
          metadata: {
            useLiteralContent: true
          },
          outputSelection: {
            '*': {
              '*': [
                'metadata',
                'evm.bytecode',
                'evm.deployedBytecode'
              ]
            }
          }
        }
      }), function findImport (name) {
        switch(name) {
          case 'Imported.sol': return {contents: 'contract Imported {}'}
          default: return {error: 'File not found'}
        }
      }))
      var provider = Ganache.provider()
      var web3 = new Web3(provider)
      var accounts = await web3.eth.getAccounts()
      var bytecode = '0x' + solcJson.contracts['MyContract.sol']['MyContract'].evm.bytecode.object
      var createTx = await web3.eth.sendTransaction({data: bytecode, from: accounts[0], gasLimit: 1000000})
      var callTx = await web3.eth.sendTransaction({from: accounts[0], value: 1, to: createTx.contractAddress})
      var txInfo = await ethereumDebugger._extractTxInfo(callTx.transactionHash, provider, solcJson, {})
      // Check that at least one of the info hashes has corresponding info
      expect(txInfo.sources).to.have.property('MyContract.sol')
      expect(txInfo.sources).to.have.property('Imported.sol')
    })
  })
})
