import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outputDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../exams/gate-da-2027-probability",
);

const choose = (n, r) => {
  let result = 1;
  for (let i = 1; i <= r; i++) result = (result * (n - r + i)) / i;
  return result;
};
const fmt = (n) => Number(n.toFixed(6)).toString();
const item = (prompt, answer, working, topic) => ({ prompt, answer, working, topic });

const easy = [
  item(
    "An event has probability 0.27. Find the probability that it does not occur.",
    0.73,
    "Use the complement rule: $1-0.27=0.73$.",
    "prob.events",
  ),
  item(
    "Events A and B are disjoint, with probabilities 0.18 and 0.31. Find $P(A\\cup B)$.",
    0.49,
    "For disjoint events, add: $0.18+0.31=0.49$.",
    "prob.events",
  ),
  item(
    "$P(A)=0.6$, $P(B)=0.5$, and $P(A\\cap B)=0.3$. Find $P(A\\cup B)$.",
    0.8,
    "Inclusion-exclusion gives $0.6+0.5-0.3=0.8$.",
    "prob.events",
  ),
  item(
    "A and B are independent, with probabilities 0.4 and 0.25. Find $P(A\\cap B)$.",
    0.1,
    "Independence gives $P(A)P(B)=0.4(0.25)=0.1$.",
    "prob.cond",
  ),
  item(
    "$P(A\\cap B)=0.21$ and $P(B)=0.7$. Find $P(A\\mid B)$.",
    0.3,
    "Divide the joint probability by the conditioning probability: $0.21/0.7=0.3$.",
    "prob.cond",
  ),
  item(
    "$P(A)=0.45$ and $P(B\\mid A)=0.2$. Find $P(A\\cap B)$.",
    0.09,
    "The multiplication rule gives $0.45(0.2)=0.09$.",
    "prob.cond",
  ),
  item(
    "Five distinct books are arranged in a row. How many orders are possible?",
    120,
    "There are $5!=120$ permutations.",
    "prob.count",
  ),
  item(
    "Choose 2 students from a group of 7. How many pairs are possible?",
    21,
    "Order does not matter: $\\binom72=21$.",
    "prob.count",
  ),
  item(
    "A fair coin is tossed 3 times. How many equally likely outcome strings are possible?",
    8,
    "Each toss has 2 outcomes, so $2^3=8$.",
    "prob.count",
  ),
  item(
    "A binomial random variable has $n=4$ and $p=0.5$. Find $P(X=1)$.",
    0.25,
    "$\\binom41(0.5)^1(0.5)^3=4/16=0.25$.",
    "prob.dist",
  ),
  item(
    "For $X\\sim\\mathrm{Binomial}(5,0.2)$, find $P(X=0)$.",
    0.32768,
    "$(1-0.2)^5=0.8^5=0.32768$.",
    "prob.dist",
  ),
  item(
    "A Bernoulli random variable has success probability 0.35. Find its expectation.",
    0.35,
    "For Bernoulli$(p)$, $E[X]=p=0.35$.",
    "prob.moments",
  ),
  item(
    "A Bernoulli random variable has success probability 0.4. Find its variance.",
    0.24,
    "$p(1-p)=0.4(0.6)=0.24$.",
    "prob.moments",
  ),
  item(
    "For $X\\sim\\mathrm{Poisson}(2)$, find $P(X=0)$.",
    Math.exp(-2),
    "$P(X=0)=e^{-2}2^0/0!=e^{-2}\\approx0.135335$.",
    "prob.dist",
  ),
  item(
    "For $X\\sim\\mathrm{Poisson}(1)$, find $P(X=1)$.",
    Math.exp(-1),
    "$P(X=1)=e^{-1}\\approx0.367879$.",
    "prob.dist",
  ),
  item(
    "$X$ is uniform on $[0,10]$. Find $P(2\\le X\\le 5)$.",
    0.3,
    "Uniform probability is interval length over total length: $(5-2)/10=0.3$.",
    "prob.dist",
  ),
  item(
    "$X$ is uniform on $[2,8]$. Find $E[X]$.",
    5,
    "The uniform mean is $(2+8)/2=5$.",
    "prob.dist",
  ),
  item(
    "$X$ is exponential with rate $\\lambda=2$. Find $P(X>1)$.",
    Math.exp(-2),
    "The survival probability is $e^{-\\lambda x}=e^{-2}\\approx0.135335$.",
    "prob.dist",
  ),
  item(
    "A discrete variable has $F(2)=0.35$ and $F(5)=0.8$. Find $P(2<X\\le5)$.",
    0.45,
    "Use the CDF difference: $F(5)-F(2)=0.8-0.35=0.45$.",
    "prob.rv",
  ),
  item(
    "$X$ equals 0 with probability 0.6 and 10 with probability 0.4. Find $E[X]$.",
    4,
    "$E[X]=0(0.6)+10(0.4)=4$.",
    "prob.moments",
  ),
  item(
    "$X$ takes values 1 and 3 with equal probability. Find $\\operatorname{Var}(X)$.",
    1,
    "The mean is 2 and the mean squared deviation is $((1-2)^2+(3-2)^2)/2=1$.",
    "prob.moments",
  ),
  item(
    "A population has mean 12. Find the expected value of the sample mean for a random sample.",
    12,
    "The sample mean is unbiased: $E[\\bar X]=\\mu=12$.",
    "prob.limit",
  ),
  item(
    "A population standard deviation is 8. For sample size 16, find the standard error of the mean.",
    2,
    "$\\sigma_{\\bar X}=\\sigma/\\sqrt n=8/4=2$.",
    "prob.limit",
  ),
  item(
    "$X$ is normal with mean 5. Find $P(X>5)$.",
    0.5,
    "A normal distribution is symmetric about its mean.",
    "prob.dist",
  ),
  item(
    "A box has 3 red and 2 blue balls. One ball is chosen uniformly. Find the probability it is red.",
    0.6,
    "There are 3 red outcomes among 5 equally likely balls: $3/5=0.6$.",
    "prob.count",
  ),
];

const mediumTemplates = [
  (k) => {
    const pa = 0.2 + 0.1 * k,
      pbA = 0.7,
      pbNotA = 0.1 + 0.05 * k;
    const ans = (pa * pbA) / (pa * pbA + (1 - pa) * pbNotA);
    return item(
      `A has prior probability ${fmt(pa)}. A positive result occurs with probability 0.7 given A and ${fmt(pbNotA)} given not-A. Find $P(A\\mid +)$.`,
      ans,
      `$P(+)=${fmt(pa)}(0.7)+(1-${fmt(pa)})(${fmt(pbNotA)})=${fmt(pa * pbA + (1 - pa) * pbNotA)}$. Bayes' rule gives $${fmt(pa * pbA)}/P(+)\\approx${fmt(ans)}$.`,
      "prob.bayes",
    );
  },
  (k) => {
    const n = 5 + k,
      r = 2,
      p = 0.2 + 0.1 * k;
    const ans = choose(n, r) * p ** r * (1 - p) ** (n - r);
    return item(
      `For $X\\sim\\mathrm{Binomial}(${n},${fmt(p)})$, find $P(X=2)$.`,
      ans,
      `$P(X=2)=\\binom{${n}}2(${fmt(p)})^2(1-${fmt(p)})^{${n - 2}}\\approx${fmt(ans)}$.`,
      "prob.dist",
    );
  },
  (k) => {
    const lambda = 1 + k;
    const ans = (Math.exp(-lambda) * lambda ** 2) / 2;
    return item(
      `A Poisson count has rate $\\lambda=${lambda}$. Find the probability of exactly 2 events.`,
      ans,
      `$P(X=2)=e^{-${lambda}}${lambda}^2/2!\\approx${fmt(ans)}$.`,
      "prob.dist",
    );
  },
  (k) => {
    const rate = 1 + k / 2,
      x = 0.5;
    const ans = Math.exp(-rate * x);
    return item(
      `The waiting time is exponential with rate $${fmt(rate)}$. Given that no event has occurred by time ${fmt(x)}, find the probability of waiting at least another ${fmt(x)} time units.`,
      ans,
      "The exponential distribution is memoryless. The required probability is $e^{-\\lambda x}=e^{-" +
        fmt(rate) +
        "(" +
        fmt(x) +
        ")}\\approx" +
        fmt(ans) +
        "$.",
      "prob.dist",
    );
  },
  (k) => {
    const z = 0.5 + 0.25 * k;
    const cdf = [0.6915, 0.7734, 0.8413, 0.8944, 0.9332][k];
    return item(
      `For standard normal $Z$, use the supplied value $\\Phi(${fmt(z)})=${fmt(cdf)}$ to find $P(Z>${fmt(z)})$.`,
      1 - cdf,
      "The upper-tail probability is $1-\\Phi(z)=1-" + fmt(cdf) + "=" + fmt(1 - cdf) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const p = 0.15 + 0.1 * k,
      a = 2 + k;
    return item(
      `$X$ is Bernoulli with success probability ${fmt(p)}. Find $E[${a}X+3]$.`,
      a * p + 3,
      "By linearity, $E[" +
        a +
        "X+3]=" +
        a +
        "E[X]+3=" +
        a +
        "(" +
        fmt(p) +
        ")+3=" +
        fmt(a * p + 3) +
        "$.",
      "prob.moments",
    );
  },
  (k) => {
    const ex = 1 + k,
      ey = 2 + k,
      exy = 3 + 2 * k;
    return item(
      `For random variables $X,Y$, $E[X]=${ex}$, $E[Y]=${ey}$, and $E[XY]=${exy}$. Find $\\operatorname{Cov}(X,Y)$.`,
      exy - ex * ey,
      "$\\operatorname{Cov}(X,Y)=E[XY]-E[X]E[Y]=" +
        exy +
        "-" +
        ex +
        "(" +
        ey +
        ")=" +
        (exy - ex * ey) +
        "$.",
      "prob.joint",
    );
  },
  (k) => {
    const sigma = 6 + 2 * k,
      n = 9 * (k + 1);
    return item(
      `Independent observations have standard deviation ${sigma}. For sample size ${n}, find the standard error of the sample mean.`,
      sigma / Math.sqrt(n),
      "$SE=\\sigma/\\sqrt n=" + sigma + "/\\sqrt{" + n + "}=" + fmt(sigma / Math.sqrt(n)) + "$.",
      "prob.limit",
    );
  },
  (k) => {
    const red = 4 + k,
      blue = 5,
      draw = 2;
    const ans = choose(red, 2) / choose(red + blue, 2);
    return item(
      `A bag has ${red} red and ${blue} blue objects. Two are drawn without replacement. Find the probability both are red.`,
      ans,
      "Count unordered samples: $\\binom{" +
        red +
        "}2/\\binom{" +
        (red + blue) +
        "}2=" +
        fmt(ans) +
        "$.",
      "prob.count",
    );
  },
  (k) => {
    const sigma = 4 + k,
      n = 25,
      z = 1.96;
    return item(
      `A sample mean has known standard deviation parameter $\\sigma=${sigma}$ and sample size ${n}. Find the margin of error for a 95% normal interval using critical value 1.96.`,
      (z * sigma) / Math.sqrt(n),
      "$M=1.96\\sigma/\\sqrt n=1.96(" + sigma + ")/5=" + fmt((z * sigma) / Math.sqrt(n)) + "$.",
      "prob.inference",
    );
  },
];

const hardTemplates = [
  (k) => {
    const priors = [0.2, 0.3, 0.5],
      rates = [0.01, 0.02 + k * 0.005, 0.04];
    const den = priors.reduce((s, p, i) => s + p * rates[i], 0),
      ans = (priors[1] * rates[1]) / den;
    return item(
      `Three factories supply ${priors.map((p) => Math.round(p * 100) + "%").join(", ")} of items and have defect rates 1%, ${fmt(rates[1] * 100)}%, and 4%. Given a defective item, find the probability it came from factory 2.`,
      ans,
      `Apply Bayes: $P(F_2\\mid D)=0.3(${fmt(rates[1])})/[0.2(0.01)+0.3(${fmt(rates[1])})+0.5(0.04)]\\approx${fmt(ans)}$.`,
      "prob.bayes",
    );
  },
  (k) => {
    const red = 5 + k,
      blue = 7,
      sample = 3;
    const ans = (choose(red, 2) * choose(blue, 1)) / choose(red + blue, sample);
    return item(
      `A box contains ${red} red and ${blue} blue tokens. Three are drawn without replacement. Find the probability exactly two are red.`,
      ans,
      `Use the hypergeometric count: $\\binom{${red}}2\\binom{${blue}}1/\\binom{${red + blue}}3\\approx${fmt(ans)}$.`,
      "prob.count",
    );
  },
  (k) => {
    const n = 6 + k,
      p = 0.2 + 0.1 * k;
    const ans = 1 - (1 - p) ** n - n * p * (1 - p) ** (n - 1);
    return item(
      `For $X\\sim\\mathrm{Binomial}(${n},${fmt(p)})$, find $P(X\\ge2)$.`,
      ans,
      `Use the complement: $P(X\\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\\approx${fmt(ans)}$.`,
      "prob.dist",
    );
  },
  (k) => {
    const lambda1 = 1 + k,
      lambda2 = 2 + k,
      ans = 1 / (lambda1 + lambda2);
    return item(
      `Two independent exponential waiting times have rates ${lambda1} and ${lambda2}. Find the expected time until the first event.`,
      ans,
      "The minimum is exponential with rate $\\lambda_1+\\lambda_2$. Thus $E[\\min(X,Y)]=1/(" +
        lambda1 +
        "+" +
        lambda2 +
        ")=" +
        fmt(ans) +
        "$.",
      "prob.dist",
    );
  },
  (k) => {
    const mu = 10 + k,
      sigma = 2 + k,
      n = 4 * (k + 1),
      cutoff = mu + sigma;
    return item(
      `A population has mean ${mu} and standard deviation ${sigma}. For $n=${n}$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\\bar X>${fmt(cutoff)}).`,
      0.1587,
      `The standardized cutoff is $(${fmt(cutoff)}-${mu})/[${sigma}/\\sqrt{${n}}]=1$. By the supplied normal-tail value, the probability is 0.1587.`,
      "prob.limit",
    );
  },
  (k) => {
    const p = 0.2 + 0.1 * k,
      n = 100 * (k + 1),
      ans = Math.sqrt((p * (1 - p)) / n);
    return item(
      `A sample proportion estimates a population proportion near ${fmt(p)}. For sample size ${n}, find its approximate standard error.`,
      ans,
      "$SE(\\hat p)=\\sqrt{p(1-p)/n}=\\sqrt{" +
        fmt(p * (1 - p)) +
        "/" +
        n +
        "}\\approx" +
        fmt(ans) +
        "$.",
      "prob.limit",
    );
  },
  (k) => {
    const sx = 2 + k,
      sy = 3 + k,
      rho = 0.5,
      a = 2,
      b = -1;
    const ans = a * a * sx * sx + b * b * sy * sy + 2 * a * b * rho * sx * sy;
    return item(
      `$\\sigma_X=${sx}$, $\\sigma_Y=${sy}$, and $\\operatorname{Corr}(X,Y)=0.5$. Find $\\operatorname{Var}(2X-Y)$.`,
      ans,
      "$\\operatorname{Var}(2X-Y)=4\\sigma_X^2+\\sigma_Y^2-4\\operatorname{Cov}(X,Y)$, where covariance is $0.5(" +
        sx +
        ")(" +
        sy +
        ")$. The result is " +
        fmt(ans) +
        "$.",
      "prob.joint",
    );
  },
  (k) => {
    const p = 0.25 + 0.1 * k,
      ans = 16 * p + 4 * (1 - p);
    return item(
      `$X$ is Bernoulli with success probability ${fmt(p)}. Find $E[(2X+2)^2]$.`,
      ans,
      "When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(" +
        fmt(p) +
        ")+4(1-" +
        fmt(p) +
        ")=" +
        fmt(ans) +
        "$.",
      "prob.moments",
    );
  },
  (k) => {
    const l1 = 2 + k,
      l2 = 3 + k,
      ans = l1 + l2;
    return item(
      `Independent counts are Poisson with rates ${l1} and ${l2}. Find the variance of their sum.`,
      ans,
      "Independent Poisson variables sum to a Poisson variable with rate $\\lambda_1+\\lambda_2=" +
        l1 +
        "+" +
        l2 +
        "=" +
        ans +
        "$; a Poisson variance equals its rate.",
      "prob.dist",
    );
  },
  (k) => {
    const sigma = 5 + k,
      n = 100,
      ans = (1.96 * sigma) / Math.sqrt(n);
    return item(
      `A normal population has known standard deviation ${sigma}. For $n=${n}$, find the 95% confidence-interval margin using critical value 1.96.`,
      ans,
      "$1.96\\sigma/\\sqrt n=1.96(" + sigma + ")/10=" + fmt(ans) + "$.",
      "prob.inference",
    );
  },
  (k) => {
    const xbar = 12 + k,
      mu0 = 10,
      sigma = 4 + k,
      n = 16,
      ans = (xbar - mu0) / (sigma / Math.sqrt(n));
    return item(
      `A z test has $\\bar x=${xbar}$, null mean 10, known $\\sigma=${sigma}$, and $n=16$. Find the z statistic.`,
      ans,
      "$z=(\\bar x-\\mu_0)/(\\sigma/\\sqrt n)=(" +
        xbar +
        "-10)/(" +
        sigma +
        "/4)=" +
        fmt(ans) +
        "$.",
      "prob.inference",
    );
  },
  (k) => {
    const a = 8 + k,
      b = 10 + k,
      c = 12 + k,
      d = 10 + k;
    const r1 = a + b,
      r2 = c + d,
      c1 = a + c,
      c2 = b + d,
      total = r1 + r2;
    const expected = [(r1 * c1) / total, (r1 * c2) / total, (r2 * c1) / total, (r2 * c2) / total];
    const observed = [a, b, c, d];
    const ans = observed.reduce((s, o, i) => s + (o - expected[i]) ** 2 / expected[i], 0);
    return item(
      `A 2 by 2 table has observed counts [[${a},${b}],[${c},${d}]]. Find the Pearson chi-square statistic for independence.`,
      ans,
      `Compute expected counts as row total times column total divided by ${total}; then sum $(O-E)^2/E$ over four cells. This gives $${fmt(ans)}$.`,
      "prob.inference",
    );
  },
  (k) => {
    const n = 20 + 5 * k,
      successes = 7 + k,
      ans = successes / n;
    return item(
      `In ${n} independent Bernoulli trials, ${successes} are successes. Find the maximum-likelihood estimate of the success probability.`,
      ans,
      "The Bernoulli likelihood is maximized at the observed proportion: $\\hat p=x/n=" +
        successes +
        "/" +
        n +
        "=" +
        fmt(ans) +
        "$.",
      "prob.inference",
    );
  },
  (k) => {
    const p = 0.3 + 0.05 * k,
      a = 2 + k,
      b = 5 + k,
      ans = p * a + (1 - p) * b;
    return item(
      `A group indicator $G$ has $P(G=1)=${fmt(p)}$. Conditional means are $E[X\\mid G=1]=${a}$ and $E[X\\mid G=0]=${b}$. Find $E[X]$.`,
      ans,
      `Use total expectation: $E[X]=${fmt(p)}(${a})+(1-${fmt(p)})(${b})=${fmt(ans)}$.`,
      "prob.moments",
    );
  },
  (k) => {
    const low = 1 + k,
      high = 5 + 2 * k,
      slope = 1 / (high - low);
    const a = low + (high - low) * 0.25,
      b = low + (high - low) * 0.75,
      ans = (b - a) * slope;
    return item(
      `A continuous variable has constant density on [${low},${high}]. Find $P(${fmt(a)}<X\\le ${fmt(b)})$.`,
      ans,
      "The density is $1/(" +
        high +
        "-" +
        low +
        ")=" +
        fmt(slope) +
        "$, so interval probability is $(" +
        fmt(b) +
        "-" +
        fmt(a) +
        ")(" +
        fmt(slope) +
        ")=0.5$.",
      "prob.rv",
    );
  },
  (k) => {
    const n1 = 4 + k,
      n2 = 6 + k,
      p = 0.25,
      ans = (n1 + n2) * p;
    return item(
      `Independent $X\\sim\\mathrm{Binomial}(${n1},0.25)$ and $Y\\sim\\mathrm{Binomial}(${n2},0.25)$. Find $E[X+Y]$.`,
      ans,
      "Linearity gives $E[X+Y]=n_1p+n_2p=(" + n1 + "+" + n2 + ")(0.25)=" + fmt(ans) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const p = 0.2 + 0.1 * k,
      n = 10 + 2 * k;
    const ans = n * p * (1 - p);
    return item(
      `For $X\\sim\\mathrm{Binomial}(${n},${fmt(p)})$, find its variance.`,
      ans,
      "$\\operatorname{Var}(X)=np(1-p)=" +
        n +
        "(" +
        fmt(p) +
        ")(1-" +
        fmt(p) +
        ")=" +
        fmt(ans) +
        "$.",
      "prob.moments",
    );
  },
  (k) => {
    const l1 = 1 + k,
      l2 = 2 + k,
      t = 0.5;
    const ans = Math.exp(-(l1 + l2) * t);
    return item(
      `Two independent Poisson processes have rates ${l1} and ${l2}. Find the probability of no event from either process in the next ${t} time unit.`,
      ans,
      "The combined process has rate $\\lambda_1+\\lambda_2=" +
        (l1 + l2) +
        "$. Thus $P(N=0)=e^{-(" +
        (l1 + l2) +
        ")(" +
        t +
        ")}\\approx" +
        fmt(ans) +
        "$.",
      "prob.dist",
    );
  },
  (k) => {
    const mean1 = 2 + k,
      mean0 = 6 + k,
      p = 0.25,
      var1 = 1 + k,
      var0 = 2 + k;
    const mean = p * mean1 + (1 - p) * mean0;
    const ans = p * (var1 + (mean1 - mean) ** 2) + (1 - p) * (var0 + (mean0 - mean) ** 2);
    return item(
      `A group $G$ has probability 0.25. Conditional means of $X$ are ${mean1} if $G=1$ and ${mean0} otherwise; conditional variances are ${var1} and ${var0}. Find $\\operatorname{Var}(X)$.`,
      ans,
      `Use total variance: $E[\\operatorname{Var}(X\\mid G)]+\\operatorname{Var}(E[X\\mid G])$. The conditional mean is ${fmt(mean)}; substitution gives $${fmt(ans)}$.`,
      "prob.moments",
    );
  },
  (k) => {
    const rate = 0.5 + 0.25 * k,
      x = 1 + k,
      ans = 1 - Math.exp(-rate * x);
    return item(
      `An exponential lifetime has rate $${fmt(rate)}$. Find the probability it is at most ${x}.`,
      ans,
      "$F(x)=1-e^{-\\lambda x}=1-e^{-" + fmt(rate) + "(" + x + ")}\\approx" + fmt(ans) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const mu = 20 + k,
      sigma = 4,
      n = 16,
      se = sigma / Math.sqrt(n),
      cutoff = mu + 1.5 * se;
    return item(
      `A population has mean ${mu} and standard deviation ${sigma}. For $n=${n}$, use $P(Z>1.5)=0.0668$ to find $P(\\bar X>${fmt(cutoff)}).`,
      0.0668,
      `The standard error is $${sigma}/\\sqrt{${n}}=1$, so the standardized cutoff is 1.5. By the supplied normal-tail value, the probability is 0.0668.`,
      "prob.limit",
    );
  },
];

const pyqTemplates = [
  (k) => {
    const p = 0.1 * (k + 1),
      n = 2 + k,
      ans = 1 - (1 - p) ** n;
    return item(
      `A component fails independently with probability ${fmt(p)}. For ${n} components, find the probability at least one fails.`,
      ans,
      "Use the complement: $1-(1-" + fmt(p) + ")^" + n + "=" + fmt(ans) + "$.",
      "prob.events",
    );
  },
  (k) => {
    const pb = 0.2 + 0.1 * k,
      joint = 0.05 + 0.05 * k,
      ans = joint / pb;
    return item(
      "$P(A\\cap B)=" + fmt(joint) + "$ and $P(B)=" + fmt(pb) + "$. Find $P(A\\mid B)$.",
      ans,
      "$P(A\\mid B)=P(A\\cap B)/P(B)=" + fmt(joint) + "/" + fmt(pb) + "=" + fmt(ans) + "$.",
      "prob.cond",
    );
  },
  (k) => {
    const prior = 0.01 * (k + 1),
      sens = 0.9,
      fpr = 0.02 + 0.01 * k;
    const ans = (prior * sens) / (prior * sens + (1 - prior) * fpr);
    return item(
      `A condition has prevalence ${fmt(prior)}; a test has sensitivity 0.9 and false-positive rate ${fmt(fpr)}. Find the probability of the condition given a positive result.`,
      ans,
      `Bayes' rule gives $${fmt(prior)}(0.9)/[${fmt(prior)}(0.9)+(1-${fmt(prior)})(${fmt(fpr)})]\\approx${fmt(ans)}$.`,
      "prob.bayes",
    );
  },
  (k) => {
    const n = 4 + k,
      p = 0.5,
      ans = choose(n, 2) * p ** n;
    return item(
      `For $X\\sim\\mathrm{Binomial}(${n},0.5)$, find $P(X=2)$.`,
      ans,
      "$P(X=2)=\\binom{" + n + "}2(0.5)^" + n + "=" + fmt(ans) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const l = 1 + k,
      ans = Math.exp(-l) * l;
    return item(
      `A Poisson random variable has mean ${l}. Find $P(X=1)$.`,
      ans,
      "$P(X=1)=e^{-" + l + "}" + l + "\\approx" + fmt(ans) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const a = k,
      b = a + 4,
      low = a + 1,
      high = a + 3,
      ans = (high - low) / (b - a);
    return item(
      `$X$ is uniform on [${a},${b}]. Find $P(${low}<X<${high})$.`,
      ans,
      "The interval length is 2 and total length is 4, giving probability $2/4=0.5$.",
      "prob.dist",
    );
  },
  (k) => {
    const z = [0.5, 1, 1.5, 2, 2.5][k],
      upper = [0.6915, 0.8413, 0.9332, 0.9772, 0.9938][k],
      ans = upper - 0.5;
    return item(
      `For standard normal $Z$, use $\\Phi(${fmt(z)})=${fmt(upper)}$ to find $P(0<Z<${fmt(z)})$.`,
      ans,
      "$P(0<Z<z)=\\Phi(z)-\\Phi(0)=" + fmt(upper) + "-0.5=" + fmt(ans) + "$.",
      "prob.dist",
    );
  },
  (k) => {
    const p = 0.1 + k * 0.1,
      ans = 1 + p;
    return item(
      "$X$ is Bernoulli with success probability " + fmt(p) + ". Find $E[1+X]$.",
      ans,
      "$E[1+X]=1+E[X]=1+" + fmt(p) + "=" + fmt(ans) + "$.",
      "prob.moments",
    );
  },
  (k) => {
    const sigma = 2 + k,
      n = 4 * (k + 1),
      ans = sigma / Math.sqrt(n);
    return item(
      `A population standard deviation is ${sigma}. For sample size ${n}, find the standard error of the sample mean.`,
      ans,
      "$SE=\\sigma/\\sqrt n=" + sigma + "/\\sqrt{" + n + "}=" + fmt(ans) + "$.",
      "prob.limit",
    );
  },
  (k) => {
    const n = 25 * (k + 1),
      p = 0.4,
      ans = Math.sqrt((p * (1 - p)) / n);
    return item(
      `For a sample proportion near 0.4 based on $n=${n}$ observations, find the approximate standard error.`,
      ans,
      "$SE=\\sqrt{p(1-p)/n}=\\sqrt{0.4(0.6)/" + n + "}\\approx" + fmt(ans) + "$.",
      "prob.limit",
    );
  },
];

function renderPractice(id, groups) {
  const questions = groups.flatMap((group) => group);
  let output = "";
  for (const [index, entry] of questions.entries()) {
    const qid = `${id}-${String(index + 1).padStart(3, "0")}`;
    output += `:::question{#${qid} type=nat marks=1 topic=${entry.topic} difficulty=${entry.difficulty}}\n${entry.prompt}\n:::\n\n`;
    output += `:::solution{#${qid} answer=${fmt(entry.answer)} tolerance=0.0001}\n${entry.working}\n:::\n\n`;
  }
  return output;
}

const medium = mediumTemplates.flatMap((template) =>
  Array.from({ length: 5 }, (_, k) => ({ ...template(k), difficulty: "medium" })),
);
const hard = hardTemplates
  .flatMap((template) =>
    Array.from({ length: 5 }, (_, k) => ({ ...template(k), difficulty: "hard" })),
  )
  .slice(0, 100);
const pyq = pyqTemplates.flatMap((template) =>
  Array.from({ length: 5 }, (_, k) => ({ ...template(k), difficulty: "medium" })),
);

const packs = [
  ["gate-da-2027-probability-easy", easy.map((q) => ({ ...q, difficulty: "easy" }))],
  ["gate-da-2027-probability-medium", medium],
  ["gate-da-2027-probability-hard", hard],
  ["gate-da-2027-probability-pyq-style", pyq],
];

await mkdir(outputDirectory, { recursive: true });
for (const [id, questions] of packs) {
  await writeFile(path.join(outputDirectory, `${id}.xp`), renderPractice(id, [questions]));
  console.log(`${id}: ${questions.length} questions`);
}
