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

    render(row) {
        const model = this;
        row.innerHTML = `
            <td class="monospace"><span class="blockNumber">${model.block}</span></td>
            <td class="monospace" title='${model.tx}'><span class="transactionNumber">${model.tx}</span></td>
            <td class="monospace address from" data-address='${model.from}'>${model.from}</td>
            <td class="monospace to" title="${model.to || ''}"><span class=icon>${model.isContractCreation ? "📰" : "·"}</span> <span data-address='${model.to||''}' class=address>${model.isContractCreation ? "Contract Creation" : model.to}</span></td>
            <td class="value">${model.value.toLocaleString()} Ether</div></td>
        `;
    }
}