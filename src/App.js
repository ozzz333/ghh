import React, { useState, useMemo, useEffect } from 'react';

const Card = ({ children }) => <div className="border rounded-xl p-4 shadow bg-white">{children}</div>;
const CardContent = ({ children, className }) => <div className={className}>{children}</div>;
const Button = ({ children, className = '', ...props }) => (
  <button
    className={`bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded ${className}`}
    {...props}
  >
    {children}
  </button>
);

export default function ParlayBuilder() {
  const [legs, setLegs] = useState([]);
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletBalance, setWalletBalance] = useState(null);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [history, setHistory] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [timeframe, setTimeframe] = useState("24-hour");
  const [lowerBound, setLowerBound] = useState(0);
  const [upperBound, setUpperBound] = useState(0);
  const [betAmount, setBetAmount] = useState(100);
  const [error, setError] = useState("");
  const [livePrice, setLivePrice] = useState(0);
  const [liveVolatility, setLiveVolatility] = useState(null);
  const [isTransacting, setIsTransacting] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState(null);

  // Treasury wallet address where bets will be sent
  const TREASURY_WALLET = "DQeRRYooThKaTY4XZyeiFFpPnrqLSrdmEGhJzXpXYswg"; // Replace with your actual treasury wallet address

  const RANGE_WIDTHS = {
  BTC: {
    "1-hour": { min: 0.005, max: 0.05 },
    "24-hour": { min: 0.01, max: 0.12 },
    "7-day": { min: 0.015, max: 0.18 },
    "30-day": { min: 0.025, max: 0.25 }
  },
  ETH: {
    "1-hour": { min: 0.0075, max: 0.06 },
    "24-hour": { min: 0.015, max: 0.15 },
    "7-day": { min: 0.025, max: 0.22 },
    "30-day": { min: 0.035, max: 0.30 }
  },
  SOL: {
    "1-hour": { min: 0.01, max: 0.07 },
    "24-hour": { min: 0.02, max: 0.17 },
    "7-day": { min: 0.03, max: 0.25 },
    "30-day": { min: 0.04, max: 0.35 }
  },
  LINK: {
    "1-hour": { min: 0.01, max: 0.08 },
    "24-hour": { min: 0.02, max: 0.18 },
    "7-day": { min: 0.03, max: 0.26 },
    "30-day": { min: 0.04, max: 0.36 }
  },
  DOGE: {
    "1-hour": { min: 0.015, max: 0.10 },
    "24-hour": { min: 0.025, max: 0.20 },
    "7-day": { min: 0.035, max: 0.30 },
    "30-day": { min: 0.05, max: 0.40 }
  }
};

const ASSETS = {
    BTC: { name: "Bitcoin", symbol: "bitcoin", volatility: 0.02, marketCapTier: "Mega" },
    ETH: { name: "Ethereum", symbol: "ethereum", volatility: 0.025, marketCapTier: "Large" },
    SOL: { name: "Solana", symbol: "solana", volatility: 0.035, marketCapTier: "Mid" },
    LINK: { name: "Chainlink", symbol: "chainlink", volatility: 0.04, marketCapTier: "Small" },
    DOGE: { name: "Dogecoin", symbol: "dogecoin", volatility: 0.06, marketCapTier: "Micro" }
  };

  const TIMEFRAMES = {
    "1-hour": 1,
    "4-hour": 4,
    "24-hour": 24,
    "48-hour": 48,
    "3-day": 72,
    "7-day": 168,
    "14-day": 336,
    "30-day": 720
  };

  useEffect(() => {
    if (window.solana && window.solana.isPhantom) {
      window.solana.connect({ onlyIfTrusted: true })
        .then(async (res) => {
          const address = res.publicKey.toString();
          setWalletAddress(address);
          const connection = new window.solanaWeb3.Connection("https://api.mainnet-beta.solana.com");
          const balance = await connection.getBalance(res.publicKey);
          setWalletBalance((balance / 1e9).toFixed(2));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ASSETS[selectedAsset].symbol}&vs_currencies=usd`);
        const data = await res.json();
        setLivePrice(data[ASSETS[selectedAsset].symbol].usd);
      } catch (err) {
        console.error("Error fetching live price", err);
        setLivePrice(0);
      }
    }
    fetchPrice();
  }, [selectedAsset]);

  useEffect(() => {
    async function fetchVolatility() {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/coins/${ASSETS[selectedAsset].symbol}/market_chart?vs_currency=usd&days=90&interval=daily`);
        const data = await res.json();
        const prices = data.prices.map(p => p[1]);
        const returns = prices.slice(1).map((price, i) => Math.log(price / prices[i]));
        const mean = returns.reduce((acc, r) => acc + r, 0) / returns.length;
        const variance = returns.reduce((acc, r) => acc + Math.pow(r - mean, 2), 0) / returns.length;
        const outlierCount = prices.slice(1).reduce((count, price, i) => {
          const change = Math.abs((price - prices[i]) / prices[i]);
          return count + (change >= 0.10 ? 1 : 0);
        }, 0);
        const tailFactor = 1 + Math.min(outlierCount / 90, 0.25);
        const dailyVolatility = Math.sqrt(variance) * tailFactor;
        setLiveVolatility(dailyVolatility);
      } catch (err) {
        console.error("Error fetching volatility", err);
        setLiveVolatility(null);
      }
    }
    fetchVolatility();
  }, [selectedAsset]);

  const calculateProbability = (price, lower, upper, volatility, timeframe, marketCapTier) => {
    const MARKET_CAP_MULTIPLIERS = {
      Mega: 0.8,
      Large: 0.9,
      Mid: 1.0,
      Small: 1.1,
      Micro: 1.2
    };
    const baseMultiplier = MARKET_CAP_MULTIPLIERS[marketCapTier] || 1.0;

    const tfHours = TIMEFRAMES[timeframe];
    const tailRiskFactor = 1 + Math.pow(Math.abs(upper - lower) / price, 0.5);
    const stdDev = price * volatility * Math.sqrt(tfHours / 24) * baseMultiplier * tailRiskFactor;

    const z1 = (Math.min(lower, upper) - price) / stdDev;
    const z2 = (Math.max(lower, upper) - price) / stdDev;
    const normalCDF = z => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI / 8) * z));
    const probability = normalCDF(z2) - normalCDF(z1);

    return Math.min(probability, 0.25);
  };

  const selectedRangePercent = useMemo(() => {
    if (!lowerBound || !upperBound || upperBound <= lowerBound || livePrice === 0) return null;
    const range = (Math.abs(upperBound - lowerBound) / livePrice) * 100;
    return range.toFixed(2);
  }, [lowerBound, upperBound, livePrice]);

  const rangeDifficultyLabel = useMemo(() => {
    const width = Math.abs(upperBound - lowerBound) / livePrice;
    if (width <= 0.02) return "Hard";
    if (width <= 0.05) return "Medium";
    return "Easy";
  }, [lowerBound, upperBound, livePrice]);

  const parlayProbability = useMemo(() => {
    if (legs.length === 0 || !liveVolatility || !livePrice) return 0;
    let prob = legs.reduce((acc, leg) => {
      const asset = ASSETS[leg.asset];
      const p = calculateProbability(
        leg.priceAtAdd,
        leg.lowerBound,
        leg.upperBound,
        leg.volatilityAtAdd,
        leg.timeframe,
        asset.marketCapTier
      );
      if (isNaN(p) || p === 0) return 0;
      return acc * p;
    }, 1);
    const correlationDiscount = 0.83; // static for now
    const parlayBonus = legs.length >= 4 ? 1.05 : 1.0;
    return (prob / correlationDiscount) * parlayBonus;
  }, [legs, liveVolatility, livePrice]);

  const parlayOdds = useMemo(() => {
    if (parlayProbability === 0) return 0;
    return (1 / parlayProbability) * 0.93; // 7% house edge
  }, [parlayProbability]);

  const totalPayout = useMemo(() => {
    return betAmount * parlayOdds;
  }, [betAmount, parlayOdds]);

  // Function to create and send a Solana transaction
  const sendBetTransaction = async () => {
    if (!window.solana || !window.solana.isPhantom) {
      setError("Phantom wallet not connected");
      return false;
    }

    if (legs.length === 0) {
      setError("No legs added to the parlay");
      return false;
    }

    if (betAmount <= 0) {
      setError("Bet amount must be greater than 0");
      return false;
    }

    try {
      setIsTransacting(true);
      setTransactionStatus("Preparing transaction...");

      // Create connection to Solana
      const connection = new window.solanaWeb3.Connection(
        "https://api.mainnet-beta.solana.com", 
        'confirmed'
      );

      // Get user public key
      const fromPubkey = window.solana.publicKey;
      
      // Parse treasury wallet address
      const toPubkey = new window.solanaWeb3.PublicKey(TREASURY_WALLET);
      
      // Create a transaction
      const transaction = new window.solanaWeb3.Transaction().add(
        // Create a transfer instruction
        window.solanaWeb3.SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: betAmount * 1e9, // Convert SOL to lamports
        })
      );

      // Create a memo instruction with bet data
      const betData = {
        legs: legs.map(leg => ({
          asset: leg.asset,
          timeframe: leg.timeframe,
          lowerBound: leg.lowerBound,
          upperBound: leg.upperBound,
          priceAtAdd: leg.priceAtAdd
        })),
        odds: parlayOdds,
        timestamp: Date.now()
      };

      // Add memo instruction with bet data (the on-chain memo program)
      const memoInstruction = new window.solanaWeb3.TransactionInstruction({
        keys: [],
        programId: new window.solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
        data: Buffer.from(JSON.stringify(betData).substring(0, 500)) // Limit memo size
      });
      transaction.add(memoInstruction);

      // Get recent blockhash
      const { blockhash } = await connection.getRecentBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromPubkey;

      // Sign and send transaction
      setTransactionStatus("Awaiting wallet approval...");
      const signed = await window.solana.signTransaction(transaction);
      
      setTransactionStatus("Sending transaction to Solana...");
      const signature = await connection.sendRawTransaction(signed.serialize());
      
      // Wait for confirmation
      setTransactionStatus("Confirming transaction...");
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error("Transaction failed: " + confirmation.value.err);
      }

      // Transaction succeeded
      setTransactionStatus("Transaction confirmed! Signature: " + signature);
      
      // Add bet to history with transaction signature
      const ticket = {
        legs,
        betAmount,
        timestamp: new Date().toISOString(),
        signature,
        status: 'confirmed'
      };
      
      setHistory([ticket, ...history]);
      setLegs([]);
      setIsTransacting(false);
      
      // Refresh wallet balance
      const balance = await connection.getBalance(fromPubkey);
      setWalletBalance((balance / 1e9).toFixed(2));
      
      return true;
    } catch (err) {
      console.error("Transaction failed", err);
      setError("Transaction failed: " + err.message);
      setTransactionStatus("Transaction failed");
      setIsTransacting(false);
      return false;
    }
  };

  return (
    <div className="p-4 space-y-6 bg-white text-black min-h-screen flex flex-col items-center">
      <div className="relative w-full max-w-2xl">
        <h1 className="text-4xl font-extrabold text-center">prly.fun</h1>
        <Button
          className="absolute right-0 top-0 text-sm"
          onClick={async () => {
            if (walletAddress) {
              setShowDisconnect(!showDisconnect);
              return;
            }
            if (window.solana && window.solana.isPhantom) {
              try {
                const response = await window.solana.connect();
                const address = response.publicKey.toString();
                setWalletAddress(address);
                const connection = new window.solanaWeb3.Connection("https://api.mainnet-beta.solana.com");
                const balance = await connection.getBalance(response.publicKey);
                setWalletBalance((balance / 1e9).toFixed(2));
              } catch (error) {
                console.error("User denied wallet connection", error);
              }
            } else {
              alert("Phantom Wallet not found. Please install it.");
            }
          }}
        >
          {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} (${walletBalance ?? '?'} SOL)` : "Connect Wallet"}
        </Button>
        {showDisconnect && (
          <div className="absolute right-0 top-10 bg-white border p-2 shadow rounded">
            <Button className="text-sm" onClick={() => {
              setWalletAddress(null);
              setWalletBalance(null);
              setShowDisconnect(false);
            }}>Disconnect</Button>
          </div>
        )}
      </div>
      <div className="w-full max-w-2xl">
        {walletAddress ? (
          <Card>
            <CardContent className="space-y-4">
              <h2 className="text-xl font-bold">Parlay Builder</h2>
              <p className="text-sm text-gray-600">Predict that the final price at the end of the selected timeframe will land <strong>within</strong> your chosen price range.</p>
              <div className="grid grid-cols-2 gap-4">
                <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
                  {Object.keys(ASSETS).map(key => (
                    <option key={key} value={key}>{ASSETS[key].name}</option>
                  ))}
                </select>
                <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
                  {Object.keys(TIMEFRAMES).map(tf => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
                <input type="number" placeholder="Lower Bound" value={lowerBound} onChange={e => setLowerBound(parseFloat(e.target.value))} />
                <input type="number" placeholder="Upper Bound" value={upperBound} onChange={e => setUpperBound(parseFloat(e.target.value))} />
              </div>
              <div className="text-sm text-gray-500">
                Allowed range for {selectedAsset} at {timeframe}: {(RANGE_WIDTHS[selectedAsset]?.[timeframe]?.min * 100).toFixed(1)}% – {(RANGE_WIDTHS[selectedAsset]?.[timeframe]?.max * 100).toFixed(1)}%
              </div>
              <div>
                <p className="text-sm text-gray-700">Live {ASSETS[selectedAsset].name} price: ${livePrice ? livePrice.toLocaleString() : "..."}</p>
                {liveVolatility && (
                  <p className="text-sm text-gray-600">Volatility (30-day): {(liveVolatility * 100).toFixed(2)}%</p>
                )}
                {selectedRangePercent && (
                  <p className="text-sm text-gray-600">Selected range width: {selectedRangePercent}% ({rangeDifficultyLabel})</p>
                )}
              </div>
              {error && <p className="text-red-600 font-semibold">{error}</p>}
              <Button onClick={() => {
                const newLeg = { asset: selectedAsset, timeframe, lowerBound, upperBound };
                const width = Math.abs(upperBound - lowerBound) / livePrice;
                const rangeConfig = RANGE_WIDTHS[selectedAsset]?.[timeframe];
                if (!rangeConfig || width < rangeConfig.min || width > rangeConfig.max) {
                  setError(`Invalid range width for ${selectedAsset}. Must be between ${(rangeConfig.min * 100).toFixed(1)}% and ${(rangeConfig.max * 100).toFixed(1)}% of price.`);
                  return;
                }
                setError("");
                setLegs([
                  ...legs,
                  {
                    ...newLeg,
                    id: Date.now(),
                    priceAtAdd: livePrice,
                    volatilityAtAdd: liveVolatility
                  }
                ]);
              }}>Add to Parlay</Button>
              <div className="mt-4">
                <h3 className="font-semibold">Current Ticket:</h3>
                <ul className="text-sm text-gray-900">
                  {legs.length === 0 ? (
                    <li className="text-gray-500">No legs added yet.</li>
                  ) : (
                    legs.map((leg) => {
                      const asset = ASSETS[leg.asset];
                      const legProb = calculateProbability(
                        leg.priceAtAdd,
                        leg.lowerBound,
                        leg.upperBound,
                        leg.volatilityAtAdd,
                        leg.timeframe,
                        asset.marketCapTier
                      );
                      const legOdds = legProb > 0 ? (1 / legProb).toFixed(1) : "N/A";
                      return (
                        <li key={leg.id} className="flex justify-between">
                          <span>
                            {leg.asset} | {leg.timeframe} | ${leg.lowerBound} - ${leg.upperBound} <span className={`ml-2 font-semibold ${((leg.lowerBound + leg.upperBound) / 2) > livePrice ? 'text-green-600' : 'text-red-600'}`}>{((leg.lowerBound + leg.upperBound) / 2) > livePrice ? '↑' : '↓'}</span>
                          </span>
                          <span className="ml-4 text-sm text-gray-500">{legOdds}x</span>
                          <Button className="ml-2 px-2 py-1 text-xs" onClick={() => setLegs(legs.filter(l => l.id !== leg.id))}>Remove</Button>
                        </li>
                      );
                    })
                  )}
                </ul>
                <div className="mt-2 font-medium text-sm text-green-700">
                  Parlay Odds: {parlayOdds.toFixed(2)}x | Win Probability: {(parlayProbability * 100).toFixed(2)}%<br />
                  Total Payout: ${totalPayout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="mt-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-gray-600">$</span>
                    <input 
                      type="number" 
                      placeholder="Bet Amount (SOL)" 
                      value={betAmount} 
                      onChange={e => setBetAmount(parseFloat(e.target.value))} 
                      className="border p-1 rounded w-32" 
                    />
                    <Button 
                      onClick={sendBetTransaction}
                      disabled={isTransacting || legs.length === 0}
                      className={isTransacting ? "opacity-50 cursor-not-allowed" : ""}
                    >
                      {isTransacting ? "Processing..." : "Place Bet On-Chain"}
                    </Button>
                  </div>
                </div>
                
                {/* Transaction Status Message */}
                {transactionStatus && (
                  <div className={`mt-2 p-2 rounded text-sm ${transactionStatus.includes("failed") ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}`}>
                    {transactionStatus}
                  </div>
                )}
                
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="text-center text-gray-500 font-medium py-8">Please connect your wallet to use the platform.</div>
        )}
      </div>
      <div className="w-full max-w-2xl">
        <Card>
          <CardContent>
            <h2 className="text-xl font-bold mb-4">Bet History</h2>
            <ul className="space-y-2 text-sm text-gray-800">
              {history.map((ticket, i) => (
                <li key={i} className="border-b pb-2">
                  <div><strong>Placed:</strong> {new Date(ticket.timestamp).toLocaleString()}</div>
                  <div><strong>Amount:</strong> {ticket.betAmount} SOL</div>
                  {ticket.signature && (
                    <div>
                      <strong>Transaction:</strong>{" "}
                      <a 
                        href={`https://explorer.solana.com/tx/${ticket.signature}`}
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {ticket.signature.slice(0, 8)}...{ticket.signature.slice(-8)}
                      </a>
                    </div>
                  )}
                  <div><strong>Status:</strong> <span className={ticket.status === 'confirmed' ? 'text-green-600' : 'text-yellow-600'}>{ticket.status || 'pending'}</span></div>
                  <div><strong>Legs:</strong>
                    <ul className="ml-4 list-disc">
                      {ticket.legs.map((leg, j) => (
                        <li key={j} className={`flex justify-between ${((leg.lowerBound + leg.upperBound) / 2) > livePrice ? 'text-green-600' : 'text-red-600'}`}>
                          <span>{leg.asset} | {leg.timeframe} | ${leg.lowerBound} - ${leg.upperBound}</span>
                          <span className="ml-2 font-bold">{((leg.lowerBound + leg.upperBound) / 2) > livePrice ? '↑' : '↓'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
