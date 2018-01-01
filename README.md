ethereum-debugger
=================

A standalone debugger for Ethereum contracts. Give it a transaction hash,
the output from solcjs, and the sources for the contracts, and it'll produce
a single javacript-enabled HTML file to allow you to step through contract
execution.

Installing
----------

```
npm install ethereum-debugger
```

Using Programatically
---------------------

```
import {dumpTransactionTrace} from 'ethereum-debugger'

var txHash = doSomeStuff()

dumpTransactionTrace(
  txHash,
  web3.currentProvider,
  {
    solcOutput: outputFromSolcJs, // The output from running solc-js - your build framework may save this as json somewhere
    sources: {'MyContract.sol': 'pragma solidity ...'}, // An object mapping source file names to their contents
    findImport: findImport // Optional, but useful if you used solc-js's findImports functionalist
  },
  'debug/' + txHash + '.html' // Where to save the new file
)
```

Using from the CLI
------------------

Coming Soon!
