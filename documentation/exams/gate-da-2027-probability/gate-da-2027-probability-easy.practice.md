:::question{#gate-da-2027-probability-easy-001 type=nat marks=1 topic=prob.events difficulty=easy}
An event has probability 0.27. Find the probability that it does not occur.
:::

:::solution{#gate-da-2027-probability-easy-001 answer=0.73 tolerance=0.0001}
Use the complement rule: $1-0.27=0.73$.
:::

:::question{#gate-da-2027-probability-easy-002 type=nat marks=1 topic=prob.events difficulty=easy}
Events A and B are disjoint, with probabilities 0.18 and 0.31. Find $P(A\cup B)$.
:::

:::solution{#gate-da-2027-probability-easy-002 answer=0.49 tolerance=0.0001}
For disjoint events, add: $0.18+0.31=0.49$.
:::

:::question{#gate-da-2027-probability-easy-003 type=nat marks=1 topic=prob.events difficulty=easy}
$P(A)=0.6$, $P(B)=0.5$, and $P(A\cap B)=0.3$. Find $P(A\cup B)$.
:::

:::solution{#gate-da-2027-probability-easy-003 answer=0.8 tolerance=0.0001}
Inclusion-exclusion gives $0.6+0.5-0.3=0.8$.
:::

:::question{#gate-da-2027-probability-easy-004 type=nat marks=1 topic=prob.cond difficulty=easy}
A and B are independent, with probabilities 0.4 and 0.25. Find $P(A\cap B)$.
:::

:::solution{#gate-da-2027-probability-easy-004 answer=0.1 tolerance=0.0001}
Independence gives $P(A)P(B)=0.4(0.25)=0.1$.
:::

:::question{#gate-da-2027-probability-easy-005 type=nat marks=1 topic=prob.cond difficulty=easy}
$P(A\cap B)=0.21$ and $P(B)=0.7$. Find $P(A\mid B)$.
:::

:::solution{#gate-da-2027-probability-easy-005 answer=0.3 tolerance=0.0001}
Divide the joint probability by the conditioning probability: $0.21/0.7=0.3$.
:::

:::question{#gate-da-2027-probability-easy-006 type=nat marks=1 topic=prob.cond difficulty=easy}
$P(A)=0.45$ and $P(B\mid A)=0.2$. Find $P(A\cap B)$.
:::

:::solution{#gate-da-2027-probability-easy-006 answer=0.09 tolerance=0.0001}
The multiplication rule gives $0.45(0.2)=0.09$.
:::

:::question{#gate-da-2027-probability-easy-007 type=nat marks=1 topic=prob.count difficulty=easy}
Five distinct books are arranged in a row. How many orders are possible?
:::

:::solution{#gate-da-2027-probability-easy-007 answer=120 tolerance=0.0001}
There are $5!=120$ permutations.
:::

:::question{#gate-da-2027-probability-easy-008 type=nat marks=1 topic=prob.count difficulty=easy}
Choose 2 students from a group of 7. How many pairs are possible?
:::

:::solution{#gate-da-2027-probability-easy-008 answer=21 tolerance=0.0001}
Order does not matter: $\binom72=21$.
:::

:::question{#gate-da-2027-probability-easy-009 type=nat marks=1 topic=prob.count difficulty=easy}
A fair coin is tossed 3 times. How many equally likely outcome strings are possible?
:::

:::solution{#gate-da-2027-probability-easy-009 answer=8 tolerance=0.0001}
Each toss has 2 outcomes, so $2^3=8$.
:::

:::question{#gate-da-2027-probability-easy-010 type=nat marks=1 topic=prob.dist difficulty=easy}
A binomial random variable has $n=4$ and $p=0.5$. Find $P(X=1)$.
:::

:::solution{#gate-da-2027-probability-easy-010 answer=0.25 tolerance=0.0001}
$\binom41(0.5)^1(0.5)^3=4/16=0.25$.
:::

:::question{#gate-da-2027-probability-easy-011 type=nat marks=1 topic=prob.dist difficulty=easy}
For $X\sim\mathrm{Binomial}(5,0.2)$, find $P(X=0)$.
:::

:::solution{#gate-da-2027-probability-easy-011 answer=0.32768 tolerance=0.0001}
$(1-0.2)^5=0.8^5=0.32768$.
:::

:::question{#gate-da-2027-probability-easy-012 type=nat marks=1 topic=prob.moments difficulty=easy}
A Bernoulli random variable has success probability 0.35. Find its expectation.
:::

:::solution{#gate-da-2027-probability-easy-012 answer=0.35 tolerance=0.0001}
For Bernoulli$(p)$, $E[X]=p=0.35$.
:::

:::question{#gate-da-2027-probability-easy-013 type=nat marks=1 topic=prob.moments difficulty=easy}
A Bernoulli random variable has success probability 0.4. Find its variance.
:::

:::solution{#gate-da-2027-probability-easy-013 answer=0.24 tolerance=0.0001}
$p(1-p)=0.4(0.6)=0.24$.
:::

:::question{#gate-da-2027-probability-easy-014 type=nat marks=1 topic=prob.dist difficulty=easy}
For $X\sim\mathrm{Poisson}(2)$, find $P(X=0)$.
:::

:::solution{#gate-da-2027-probability-easy-014 answer=0.135335 tolerance=0.0001}
$P(X=0)=e^{-2}2^0/0!=e^{-2}\approx0.135335$.
:::

:::question{#gate-da-2027-probability-easy-015 type=nat marks=1 topic=prob.dist difficulty=easy}
For $X\sim\mathrm{Poisson}(1)$, find $P(X=1)$.
:::

:::solution{#gate-da-2027-probability-easy-015 answer=0.367879 tolerance=0.0001}
$P(X=1)=e^{-1}\approx0.367879$.
:::

:::question{#gate-da-2027-probability-easy-016 type=nat marks=1 topic=prob.dist difficulty=easy}
$X$ is uniform on $[0,10]$. Find $P(2\le X\le 5)$.
:::

:::solution{#gate-da-2027-probability-easy-016 answer=0.3 tolerance=0.0001}
Uniform probability is interval length over total length: $(5-2)/10=0.3$.
:::

:::question{#gate-da-2027-probability-easy-017 type=nat marks=1 topic=prob.dist difficulty=easy}
$X$ is uniform on $[2,8]$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-easy-017 answer=5 tolerance=0.0001}
The uniform mean is $(2+8)/2=5$.
:::

:::question{#gate-da-2027-probability-easy-018 type=nat marks=1 topic=prob.dist difficulty=easy}
$X$ is exponential with rate $\lambda=2$. Find $P(X>1)$.
:::

:::solution{#gate-da-2027-probability-easy-018 answer=0.135335 tolerance=0.0001}
The survival probability is $e^{-\lambda x}=e^{-2}\approx0.135335$.
:::

:::question{#gate-da-2027-probability-easy-019 type=nat marks=1 topic=prob.rv difficulty=easy}
A discrete variable has $F(2)=0.35$ and $F(5)=0.8$. Find $P(2<X\le5)$.
:::

:::solution{#gate-da-2027-probability-easy-019 answer=0.45 tolerance=0.0001}
Use the CDF difference: $F(5)-F(2)=0.8-0.35=0.45$.
:::

:::question{#gate-da-2027-probability-easy-020 type=nat marks=1 topic=prob.moments difficulty=easy}
$X$ equals 0 with probability 0.6 and 10 with probability 0.4. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-easy-020 answer=4 tolerance=0.0001}
$E[X]=0(0.6)+10(0.4)=4$.
:::

:::question{#gate-da-2027-probability-easy-021 type=nat marks=1 topic=prob.moments difficulty=easy}
$X$ takes values 1 and 3 with equal probability. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-easy-021 answer=1 tolerance=0.0001}
The mean is 2 and the mean squared deviation is $((1-2)^2+(3-2)^2)/2=1$.
:::

:::question{#gate-da-2027-probability-easy-022 type=nat marks=1 topic=prob.limit difficulty=easy}
A population has mean 12. Find the expected value of the sample mean for a random sample.
:::

:::solution{#gate-da-2027-probability-easy-022 answer=12 tolerance=0.0001}
The sample mean is unbiased: $E[\bar X]=\mu=12$.
:::

:::question{#gate-da-2027-probability-easy-023 type=nat marks=1 topic=prob.limit difficulty=easy}
A population standard deviation is 8. For sample size 16, find the standard error of the mean.
:::

:::solution{#gate-da-2027-probability-easy-023 answer=2 tolerance=0.0001}
$\sigma_{\bar X}=\sigma/\sqrt n=8/4=2$.
:::

:::question{#gate-da-2027-probability-easy-024 type=nat marks=1 topic=prob.dist difficulty=easy}
$X$ is normal with mean 5. Find $P(X>5)$.
:::

:::solution{#gate-da-2027-probability-easy-024 answer=0.5 tolerance=0.0001}
A normal distribution is symmetric about its mean.
:::

:::question{#gate-da-2027-probability-easy-025 type=nat marks=1 topic=prob.count difficulty=easy}
A box has 3 red and 2 blue balls. One ball is chosen uniformly. Find the probability it is red.
:::

:::solution{#gate-da-2027-probability-easy-025 answer=0.6 tolerance=0.0001}
There are 3 red outcomes among 5 equally likely balls: $3/5=0.6$.
:::

