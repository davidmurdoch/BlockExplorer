class Transaction {
    constructor(transaction, blockNumber){
        if(transaction) {
            this.block = blockNumber;
            this.tx = transaction.hash;
            this.from = transaction.from;
            this.to = transaction.to;
            this.value = parseFloat(Web3.utils.fromWei(transaction.value, "ether"), 10);
            this.isContractCreation = transaction.to === null;
        }
    }
}