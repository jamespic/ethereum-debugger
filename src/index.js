const crypto = require('crypto')
const fs = require('fs')

const binToOps = require('eth-bin-to-ops')

function makeSourceMapLookup(solcOutput) {
  let sourceMapLookup = []
  for (let contractName in solcOutput.contracts) {
    let contract = solcOutput.contracts[contractName]
    if (contract.runtimeBytecode) {
      sourceMapLookup.push({
        bytecodeRegex: new RegExp('^0x' + contract.runtimeBytecode.replace(/_.{39}/g, '.{40}') + '$'),
        sourceMap: contract.srcmapRuntime
      })
    }
    if (contract.bytecode) {
      sourceMapLookup.push({
        bytecodeRegex: new RegExp('^0x' + contract.bytecode.replace(/_.{39}/g, '.{40}')),
        sourceMap: contract.srcmap
      })
    }
  }
  return sourceMapLookup
}

function mergeContractInfo(bytecode, sourceMap, sourceList) {
  if (bytecode.startsWith('0x')) bytecode = bytecode.substring(2)
  let sourceMapSplit = sourceMap ? sourceMap.split(';') : []
  let ops = binToOps(new Buffer(bytecode, 'hex'))
  let result = {}
  let [sourceStart, sourceLength, sourceFile, jump] = [-1, -1, '', '-']
  for (let i = 0; i < ops.length; i++) {
    let op = ops[i]
    let opInfo = {
      pc: op.pc
    }
    if (op.name.startsWith('PUSH')) {
      opInfo.op = op.name + ' 0x' + op.pushData.toString('hex')
    } else {
      opInfo.op = op.name
    }

    if (i < sourceMapSplit.length) {
      let [newSourceStart, newSourceLength, newSourceFile, newJump] = sourceMapSplit[i].split(':')
      if (newSourceStart) sourceStart = parseInt(newSourceStart)
      if (newSourceLength) sourceLength = parseInt(newSourceLength)
      if (newSourceFile) sourceFile = newSourceFile != '-1' ? sourceList[parseInt(newSourceFile)] : ''
      if (newJump) jump = newJump
      opInfo.sourceStart = sourceStart
      opInfo.sourceLength = sourceLength
      opInfo.sourceFile = sourceFile
      opInfo.jump = jump
    } else {
      opInfo.sourceStart = -1
      opInfo.sourceLength = -1
      opInfo.sourceFile = ''
      opInfo.jump = '-'
    }
    result[op.pc] = opInfo
  }
  return result
}

async function extractTxInfo(txHash, web3Provider, solcOutput, sources, findImport) {
  function callRPC(method, ...args) {
    return new Promise(function(resolve, reject) {
      web3Provider.sendAsync({
        jsonrpc: '2.0',
        method: method,
        params: args,
        id: Math.floor(Math.random() * 1000000000)
      }, function(err, {result: res}) {
        if (err) reject(err)
        else resolve(res)
      })
    })
  }

  const sourceMapLookup = makeSourceMapLookup(solcOutput)
  let contractInfoLookup = {}

  for (let sourceName in solcOutput.sources) {
    if (!(sourceName in sources) && findImport != null) {
      sources[sourceName] = findImport(sourceName).contents
    }
  }

  let tx = await callRPC('eth_getTransactionByHash', txHash)

  async function findContractInfo(code) {
    let hash = crypto.createHash('sha256').update(code).digest('hex')
    if (!(hash in contractInfoLookup)) {
      for (let {bytecodeRegex, sourceMap} of sourceMapLookup) {
        if (bytecodeRegex.exec(code)) {
          let contractInfo = mergeContractInfo(code, sourceMap, Object.keys(sources))
          contractInfoLookup[hash] = contractInfo
          return hash
        }
      }
    }
    return hash
  }

  let code = await callRPC('eth_getCode', tx.to)
  let infoHash = await findContractInfo(code)

  let contractStack = [infoHash]
  let detailedTrace = []

  let trace = await callRPC('debug_traceTransaction', txHash, [])

  for (let traceItem of trace.structLogs) {
    switch (traceItem.op) {
      case 'CALL':
      case 'CALLCODE':
      case 'DELEGATECALL':
      case 'STATICCALL':
        let callee = '0x' + traceItem.stack[traceItem.stack.length - 2].substr(24, 40)
        code = await callRPC('eth_getCode', callee)
        infoHash = await findContractInfo(code)
        contractStack[traceItem.depth + 1] = infoHash
        break
      case 'CREATE':
        let joinedMemory = traceItem.memory.join('')
        let codeStart = parseInt(traceItem.stack[traceItem.stack.length - 2], 16)
        let codeLength = parseInt(traceItem.stack[traceItem.stack.length - 3], 16)
        code = joinedMemory.substring(2 * codeStart, 2 * (codeStart + codeLength))
        infoHash = await findContractInfo(code)
        contractStack[traceItem.depth + 1] = infoHash
        break
      default:
        // Truncate stack to current depth
        contractStack.length = traceItem.depth + 1
        break
    }
    detailedTrace.push({
      infoHash: contractStack[traceItem.depth], ...traceItem
    })
  }

  return {
    contractInfoLookup,
    sources,
    returnValue: trace.returnValue,
    gas: trace.gas,
    trace: detailedTrace
  }
}

async function dumpTransactionTrace(txHash, web3Provider, {solcOutput, sources, findImport}, outputLocation) {
  let template = fs.readFileSync(__dirname + '/../template.html', 'utf-8')
  let data = JSON.stringify(
    await extractTxInfo(txHash, web3Provider, solcOutput, sources, findImport),
    null, 2
  )
  fs.writeFileSync(outputLocation,
    template.replace('$DEBUGDATA', () => data).replace('$TXHASH', () => txHash)
  )
}

module.exports.dumpTransactionTrace = dumpTransactionTrace
