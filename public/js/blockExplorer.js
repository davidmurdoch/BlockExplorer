class BlockExplorer {
    constructor(web3Provider) {
        const _provider = web3Provider || Web3.givenProvider
        if(!_provider){
            throw new Error("A Web3 Provider is required");
        }

        this.web3 = new Web3(_provider);
        this.addressQueue = {};
        this.initStats();
    }

    render(rootNode) {
        if(!rootNode){
            throw new Error("You must provide a rootNode");
        }

        // initialize UI stuff
        this.rootNode = rootNode;
        rootNode.className = "explorer";
        rootNode.innerHTML = `
            <form><div><label>From:<input min="0" type="number" placeholder="From Block" name="from"></label> <label>To:<input type="number" placeholder="To Block" name="to"> inclusive. </label><button type="submit">Explore</button> <div class="float-right"><a href='./'>load latest block</a></div></div></form>
            <hr>
            <table class="stats"><tbody><tr><td><center>Loading...</center></td></tr></tbody></table>
            <hr>
            <table class="results"><thead><th>Block</th><th>Tx</th><th>From</th><th>To</th><th>Value</th></thead><tbody><tr><td><center>Loading...</center></td></tr></tbody></thead>
        `;
        this.form = rootNode.getElementsByTagName("form")[0];
        this.statsTbody = rootNode.getElementsByTagName("tbody")[0];
        this.tbody = rootNode.getElementsByTagName("tbody")[1];
        this.form.addEventListener("submit", this.update.bind(this));

        // event listener for clicking on an address so we can show it's info
        this.tbody.addEventListener("click", (e) => {
            const el = e.target;
            if(el.matches("tr .address")) {
                e.preventDefault();
                const address = el.dataset.address;
                if(!address) return;

                const addressStats = this.stats.allAddresses[address];
                if(addressStats) {
                    alert(`${address} \n\nSent: ${addressStats.sent.toLocaleString()}\nReceived: ${addressStats.received.toLocaleString()}\n\nin the given block range.`);
                }
            }
        });

        // populate initial data
        this.sync();

        this.pollEthPrice();
    }
    

    // Checks if a given address is a contract address.
    // Only checks once per address (unless an error occurs)
    getCode(address) {
        return new Promise((resolve, reject) => {
            let cache = this.addressQueue[address];
            if(cache) {
                if (cache.result) {
                    resolve(cache.result);
                }
                else {
                    cache.push(resolve);
                }
            }
            else {
                cache = this.addressQueue[address] = {
                    "result": null,
                    "_resolvers": [{resolve, reject}],
                    "push": resolve => {
                        cache._resolvers.push({resolve, reject});
                    }
                };
                return this.web3.eth.getCode(address).then(result => {
                    cache.result = result;
                    do {
                        let resolver = cache._resolvers.shift();
                        resolver.resolve(result);
                    }
                    while(cache._resolvers.length)
                }).catch(e => {
                    console.error(e);

                    do {
                        let resolver = cache._resolvers.shift();
                        resolver.reject(result);
                    }
                    while(cache._resolvers.length)

                    // if we errored out then forget about this address /shrug
                    delete this.addressQueue[address];
                });
            }
        });
    }

    parseQueryString(qs){
        return qs.replace(/^\?/, "").split("&").reduce((obj, pair) => {
            const split = pair.split("=");
            obj[split[0]] = split[1];
            return obj;
        }, {}) || {};
    }

    initStats() {
        this.stats = {
            totalEtherSent: 0,
            totalTransactions: 0,
            numContractTransactions: 0,
            uncles: 0,
            uniqueSenders: {},
            uniqueReceivers: {},
            totalBlocks: 0,
            doneBlocks: 0,
            doneTransactions: 0,
            contractCreation: 0,
            events: 0,
            allAddresses: {}
        };
    }

    updateStats() {
        const stats = this.stats;
        const contractTransactions = stats.totalTransactions > 0 ? (Math.round(stats.numContractTransactions/stats.totalTransactions*100).toLocaleString() + "%") : "n/a";
        this.statsTbody.innerHTML = `
            <td>Processed:<br><strong>${stats.doneBlocks.toLocaleString()}/${stats.totalBlocks.toLocaleString()}</strong> blocks<br><strong>${stats.doneTransactions.toLocaleString()}/${stats.totalTransactions.toLocaleString()}</strong> transactions</td>
            <td>Value Transferred:<br><strong>Ξ${stats.totalEtherSent.toLocaleString()} ETH</strong><br/><strong>${this.ethPrice?(this.ethPrice*stats.totalEtherSent).toLocaleString(undefined, {style:"currency", currency:"USD", currencyDisplay: "symbol"}):0} USD</strong></td>
            <td>Senders:<br><strong>${Object.keys(stats.uniqueSenders).length.toLocaleString()}</strong></td>
            <td>Receivers:<br><strong>${Object.keys(stats.uniqueReceivers).length.toLocaleString()}</strong></td>
            <td>Uncles:<br><strong>${stats.uncles}</strong></td>
            <td>Contract Transactions:<br><strong>${contractTransactions}</strong></td>
            <td>Contracts Created:<br><strong>${stats.contractCreation.toLocaleString()}</strong></td>
            <td>Events:<br><strong>${stats.events.toLocaleString()}</strong></td>
        `;
    }

    // initial UI draw, using either query string params or the latest block for initialization
    async sync() {
        const fromNode = this.form.querySelector("[name=from]");
        const toNode = this.form.querySelector("[name=to]");
        if (document.location.search){
            const props = this.parseQueryString(document.location.search);

            if (props.from && props.to) {
                fromNode.value = props.from;
                toNode.value = props.to;
                return this.update();
            }
        }

        const block = await this.getLatestBlockNumber().catch(e => {
            console.error(e);
        });

        if(block) {
            fromNode.value = block;
            toNode.value = block;

            return this.update();
        }
    }

    updateBlockStats(block, stats) {
        if(block.transactions){
            stats.totalTransactions += block.transactions.length;
        }
        stats.uncles += block.uncles.length;
        stats.doneBlocks++;

        this.updateStats();
    }

    processBlockTransactions(block, stats, cancellationToken) {
        const transactions = block.transactions;

        return transactions.map((transactionHash) => {
            return this.getTransaction(transactionHash)
                .then(transaction => {
                    cancellationToken.throwIfCancelled();

                    return transaction ? new Transaction(transaction, block.number) : null;
                })
                .then(model => { // calculate `from` address stats and total ether stats
                    if(!model) return;

                    const cachedFrom = (stats.allAddresses[model.from] = stats.allAddresses[model.from] || new Address(model.from));
                    cachedFrom.sent += model.value;

                    stats.uniqueSenders[model.from] = true;
                    stats.totalEtherSent += model.value;

                    return model;
                }).then(async model => {  // calculate `to` address stats
                
                    if(!model) return;

                    if(model.isContractCreation) {
                        stats.contractCreation++;
                        return model;
                    }

                    const cachedTo = (stats.allAddresses[model.to] = stats.allAddresses[model.to] || new Address(model.to));
                    cachedTo.received += model.value;

                    stats.uniqueReceivers[model.to] = true;

                    return model;
                }).then(model => { // update UI
                    cancellationToken.throwIfCancelled();

                    if(!model) return;

                    const row = document.createElement("tr");
                    row.className = "transaction"

                    model.render(row);

                    this.tbody.appendChild(row);

                    let continuation;
                    // don't bother calling getCode if this is a newly created contract because we already know it's a contract, not an address
                    if(!model.isContractCreation) {
                        continuation = this.getCode(model.to)
                            .then(result => {
                                const isContract = result !== "0x";
                                row.getElementsByClassName("icon")[0].innerHTML = isContract ? "📰" : "🏠";
                                return isContract;
                            });
                    }
                    else {
                        continuation = new Promise(resolve => resolve(true));
                    }
                    
                    return continuation.then(isContract => {
                            // if we are a contract we need to get the transaction receipt to count logs and potentially
                            // get the contractAddress, too.
                            if(!isContract) return;

                            stats.numContractTransactions++;
                            this.updateStats();

                            return this.getTransactionReceipt(transactionHash)
                                .then(result => {
                                    if(!result) return;

                                    stats.events += result.logs.length;
                                    if(model.isContractCreation && result.contractAddress) {
                                        // update the contract icon since we have
                                        model.to = result.contractAddress;

                                        const cachedTo = (stats.allAddresses[model.to] = stats.allAddresses[model.to] || new Address(model.to));
                                        cachedTo.received += model.value; // i'm pretty sure model.value will always be 0 here. :-/
                                        
                                        stats.uniqueReceivers[model.to] = true;
                                        model.render(row);
                                    }
                                });
                        });
                }).then(() => { // we're done getting all the transaction stuff we want
                    stats.doneTransactions++;
                    this.updateStats();
                }).catch((e) => {                   
                    // we dont need to process errors produced by the CancellationToken because that's what they're for
                    if(typeof e === CancellationToken.CancellationError) {
                        throw e; // meh
                    }
                });
        });
    }

    // updating the eth price here doesn't make much sense
    pollEthPrice(){
        this.getEthUSDPrice().then((price) => {
            this.ethPrice = price;
            this.updateStats();
        }).catch(e => {
            console.error(e);
        }).then(e => {
            // after the `catch` so we always try again
            setTimeout(()=>{this.pollEthPrice();}, 60000);
        })
    }

    getEthUSDPrice() {
        // todo: put a debouncer here so we don't ever accidentally call this too often/sec
        return fetch("https://api.coinmarketcap.com/v1/ticker/ethereum/")
            .then(response => response.json())
            .then(json => json[0].price_usd);
    }

    update(e) {
        const from = parseInt(this.form.querySelector("[name=from]").value, 10);
        const to = parseInt(this.form.querySelector("[name=to]").value, 10);
        const totalBlocks = to - from + 1


        if(from < 0) {
            alert("The `From` block msut be greater than or queal to 0.")
            e && e.preventDefault();
            return;
        }
        if(to < from) {
            alert("The `To` block may not precede the `From` block.")
            e && e.preventDefault();
            return;
        }
        if(totalBlocks > 1000 && !confirm("That's a lot of blocks. I can try to load everything at once. You sure you want to do this?")){
            e && e.preventDefault();
            return;
        }


        // reset:
        this.cancellationToken && this.cancellationToken.cancel();
        this.tbody.innerHTML = "";
        this.initStats();


        const stats = this.stats;
        stats.totalBlocks = totalBlocks;


        const blockPromises = [];
        const transactionPromises = [];
        this.cancellationToken = new CancellationToken();

        for(let i = from; i <= to; i++) {
            let blockCall = this.getBlock(i);

            let transactionsCall = blockCall.then(block => Promise.all(this.processBlockTransactions(block, stats, this.cancellationToken)))
            blockCall.then(block => this.updateBlockStats(block, stats, this.cancellationToken));

            blockPromises.push(blockCall);
            transactionPromises.push(transactionsCall);
        }

        if(e) {
            // in the case of a form submitted even, make sure we don't navigate away
            // it's way down here in the fn because if an error happens above at least we'd get a real form submit out of it
            e.preventDefault();
            window.history.pushState(null, "", "./?from=" + from + "&to=" + to);
        }

        // just some debug stuff:
        const blocksDone = Promise.all(blockPromises).then(() => {
            console.log("finished fetching all blocks");
        });

        const transactionsDone = Promise.all(transactionPromises).then(() => {
            console.log("finished fetching all transactions");
        });

        return Promise.all([blocksDone, transactionsDone]).then(() => {
            console.log("all done");
        });
    }

    async getLatestBlockNumber(){
        return new Promise((resolve, reject) => {
            this.web3.eth.getBlockNumber((error, result) => {
                if(error) {
                    reject(error);
                }
                else {
                    resolve(result);
                }
            });
        });
    }

    getBlock(blockId){
        return new Promise((resolve, reject) => {
            this.web3.eth.getBlock(blockId, (error, result) => {
                if(error) {
                    console.error("Couldn't get block #: " + blockId);
                    reject(error);
                }
                else {
                    resolve(result);
                }
            });
        });
    }

    getTransaction(transactionHash){
        return new Promise((resolve, reject) => {
            this.web3.eth.getTransaction(transactionHash, (err, receipt) =>{
                if(err) {
                    reject(err);
                }
                else {
                    resolve(receipt);
                }
            })
        });
    }

    async getTransactionReceipt (transactionHash) {
        return new Promise((resolve, reject) => {
            this.web3.eth.getTransactionReceipt(transactionHash, (err, receipt) =>{
                if(err) {
                    reject(err);
                }
                else {
                    resolve(receipt);
                }
            })
        });
    }
};