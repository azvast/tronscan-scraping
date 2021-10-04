const axiosParallel = require('axios-parallel');
const log = require('simple-node-logger').createSimpleLogger('progress.log');
const {
  splitArray,
  formatNumber,
  getContentByURL,
  getPrettyAmount
} = require('./utils');
require("dotenv").config();

const { appendFileSync } = require('fs');
const { default: axios } = require('axios');

const MAX_PARALLEL_REQUEST_PER_CPU = 30;

const {
  MAX_PAGE_COUNT,
  WEBHOOK_URL,
  WALLET_LIST_URL,
  ONE_SCOPE_ITEMS_COUNT
} = process.env;

let contracts = [];       // .env contracts
// load contracts
function loadContracts() {
  for (key of Object.keys(process.env).filter(key => key.startsWith('CONTRACT_ADDRESS'))) {
    contracts.push(process.env[key]);
  }
}

async function getWalletList() {
  const content = await getContentByURL(WALLET_LIST_URL)
  return content.split('\n')   // wallet addresses
}

// one page requests
function getOnePageRequest(wallet_address) {
  const requests = [];

  for (let page = 0; page < MAX_PAGE_COUNT; page++) {
    const url = `https://apilist.tronscan.org/api/token_trc20/transfers?limit=20&start=${20 * (page)}&sort=-timestamp&count=true&relatedAddress=${wallet_address}`;
    requests.push({
      method: 'GET',
      url
    });
  }

  return requests;
}

// one scope scrap
async function getOneScopeData(scope) {
  const requests = [];
  scope.forEach(wallet_address => {
    requests.push(...getOnePageRequest(wallet_address));
  });
  
  const result = [];
  const response = await axiosParallel(requests, MAX_PARALLEL_REQUEST_PER_CPU);
  response.forEach(item => {
    if (item.data) {
      const { token_transfers } = item.data;

      if (token_transfers && token_transfers.length > 0) {
        token_transfers.forEach(row => {
          const {
            transaction_id,
            block,
            from_address,
            to_address,
            confirmed,
            finalResult,
            quant,
            contract_address,
            tokenInfo: { tokenAbbr }
          } = row;

          if (confirmed && finalResult === 'SUCCESS' && contracts.some(contract => contract === contract_address)) {
            result.push({
              transaction_id,
              block,
              from: from_address,
              to: to_address,
              status: 'CONFIRMED',
              result: 'SUCCESS',
              amount: getPrettyAmount(quant, tokenAbbr),
            })
          }
        })
      }
    }
  })

  return result;
}

// webhook & file
function save(result) {
  const jsonObj = JSON.stringify(result, null, 2);

  axios.post(WEBHOOK_URL, jsonObj)
    .then(() => {
      log.info('\t* webhook.site post success!\n');
    })
    .catch(error => {
      log.error(`\t* webhook.site post faild: ${error.message}`);
    })

  appendFileSync('result.json', jsonObj);
  log.info(`\t${result && result.length} confirmed data posted successfully!`);
}

(async () => {
  let result = [];

  log.info('Start...');

  loadContracts();

  // load wallet list
  let wallets = await getWalletList();
  log.info(`${wallets.length} wallet addresses loaded.\n`)

  async function loop() {
    wallets = await getWalletList();
    log.info(`${wallets.length} wallet addresses loaded.\n`)
    let scoped_wallets = splitArray(wallets, ONE_SCOPE_ITEMS_COUNT);

    for (let i = 0; i < scoped_wallets.length; i++) {
      let scope = scoped_wallets[i];
      log.info(`Getting ${(i * ONE_SCOPE_ITEMS_COUNT) + 1} - ${(i * ONE_SCOPE_ITEMS_COUNT) + scope.length} wallets data concurrently...`);

      const new_result = await getOneScopeData(scope);

      let new_transactions = new_result.filter(new_tx =>
        !result.some(old_tx => 
          old_tx.transaction_id === new_tx.transaction_id
          && old_tx.block === new_tx.block
          && old_tx.from === new_tx.from
          && old_tx.to === new_tx.to
          && old_tx.amount === new_tx.amount
        )
      );

      log.info(`\tScraped ${new_transactions && new_transactions.length} new transaction(s).\n`);

      if (new_transactions.length) {
        const detailRequests = [];
        new_transactions.forEach(({ transaction_id }) => {
          const url = `https://apilist.tronscan.org/api/transaction-info?hash=${transaction_id}`;
          detailRequests.push({
            method: 'GET',
            url
          });
        });
  
        const detailResponse = await axiosParallel(detailRequests, MAX_PARALLEL_REQUEST_PER_CPU);
        detailResponse.forEach((item, i) => {
          if (item.details.statusCode == 200) {
            const {
              net_fee,
              energy_fee,
              energy_usage_total
            } = item.data.cost;
    
            new_transactions[i].band_width = `Burn ${net_fee / 1000000} TRX for bandwidth: ${formatNumber(net_fee / 1000)} Bandwidth`;
            new_transactions[i].energy = `Burn ${energy_fee / 1000000} TRX for energy: ${formatNumber(energy_usage_total)} Energy`;
          }
        });

        // save scope data
        save(new_transactions);

        result.push(...new_transactions);
      }
    }

    loop();
  }

  // tronscan
  const tansferRequests = [];
  wallets.forEach(wallet => {
    tansferRequests.push(...getOnePageRequest(wallet));
  })

  log.info(`Getting ${wallets && wallets.length} wallets data concurrently...`);

  try {
    const response = await axiosParallel(tansferRequests, MAX_PARALLEL_REQUEST_PER_CPU);
    response.forEach((item) => {
      if (item.data) {
        const { total, token_transfers } = item.data;
        if (token_transfers && token_transfers.length > 0) {
          token_transfers.forEach(row => {
            const {
              transaction_id,
              block,
              from_address,
              to_address,
              confirmed,
              finalResult,
              quant,
              contract_address,
              tokenInfo: { tokenAbbr }
            } = row;

            if (contracts.some(contract => contract === contract_address)) {
              if (confirmed && finalResult === 'SUCCESS') {
                result.push({
                  transaction_id,
                  block,
                  from: from_address,
                  to: to_address,
                  status: 'CONFIRMED',
                  result: 'SUCCESS',
                  amount: getPrettyAmount(quant, tokenAbbr)
                })
              }
            }
          })
        }
      }
    });

    const detailRequests = [];
    result.forEach(({ transaction_id }) => {
      const url = `https://apilist.tronscan.org/api/transaction-info?hash=${transaction_id}`;
      detailRequests.push({
        method: 'GET',
        url
      });
    });

    const detailResponse = await axiosParallel(detailRequests, MAX_PARALLEL_REQUEST_PER_CPU);
    detailResponse.forEach((item, i) => {
      if (item.details.statusCode == 200) {
        const {
          net_fee,
          energy_fee,
          energy_usage_total
        } = item.data.cost;
  
        result[i].band_width = `Burn ${net_fee / 1000000} TRX for bandwidth: ${formatNumber(net_fee / 1000)} Bandwidth`;
        result[i].energy = `Burn ${energy_fee / 1000000} TRX for energy: ${formatNumber(energy_usage_total)} Energy`;
      }
    });

    log.info(`\tScraped ${result && result.length} new transaction(s).\n`);

    // save totally
    save(result);

    loop();
  } catch (error) {
    log.error(error.message);
    console.log(error);
  }
})();