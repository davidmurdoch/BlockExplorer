const CancellationToken = (function(){
    class CancellationError extends Error {}
    let _tokens = new WeakMap();

    class CancellationToken {
        constructor(){
            _tokens.set(this, false);
        }
        cancel(){
            _tokens.set(this, true);
        }
        get cancelled(){
            return _tokens.get(this);
        }
        throwIfCancelled(){
            if(this.cancelled) throw new CancellationError("cancelled");
        }

        static get CancellationError() {
            return CancellationError;
        }
    }

    return CancellationToken;
}());