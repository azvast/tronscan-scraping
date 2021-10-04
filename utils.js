const axios = require('axios')

const getContractNameByAddress = address => (
  new Promise(resolve => {
    axios.get(`https://apilist.tronscan.org/api/contract?contract=${address}&type=contract`)
      .then(res => {
        resolve(res.data.data[0].tokenInfo.tokenAbbr)
      })
      .catch(error => {
        console.log(error)
        resolve('Not found')
      })
  })
)

const getContentByURL = url => (
  new Promise(resolve => {
    axios.get(url)
      .then(res => {
        resolve(res.data)
      })
      .catch(error => {
        console.log(error)
        resolve('Not found')
      })
  })
)

const getTokenPrecision = tokenAbbr => {
  switch (tokenAbbr) {
    case 'VNDO':
      return 2;
    case 'BCH':
      return 3;
    case 'USDT': case 'XRP': case 'ZEC': case 'CBP': case 'LUMI': case 'SVIP': case 'WIN': case 'NFT':
      return 6;
    case 'BTC' : case 'LTC': case 'ETC': case 'DASH': case 'SafeMoney':
      return 8;
    case 'XMR':
      return 16;
    case 'ETH': case 'OSK': case 'JST': case 'SUNOLD': 
      return 18;
    default:
      return 1;
  }
}

function formatNumber(num) {
  return num.toString().replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,')
}

const getPrettyAmount = ( quant, tokenAbbr ) => {
  const res = quant / (10 ** getTokenPrecision(tokenAbbr));
  return `${formatNumber(res.toFixed(2))} ${tokenAbbr}`;
}

const splitArray = (arr, itemsPerRow) => {
  return arr.reduce((acc, val, ind) => {
     const currentRow = Math.floor(ind / itemsPerRow);
     if(!acc[currentRow]){
        acc[currentRow] = [val];
     }else{
        acc[currentRow].push(val);
     };
     return acc;
  }, []);
};

module.exports = { 
  splitArray,
  formatNumber,
  getContentByURL,
  getPrettyAmount,
  getContractNameByAddress
}
