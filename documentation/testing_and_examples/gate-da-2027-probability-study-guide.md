# GATE DA 2027 Probability & Statistics: Study Guide

## Syllabus status and scope

This pack covers the Probability and Statistics portion of the GATE Data Science and Artificial Intelligence (DA) syllabus, using the established DA topic scope: counting, probability axioms and events, conditional/joint/marginal probability, independence, Bayes' theorem, random variables, expectation and variance, covariance and correlation, common discrete and continuous distributions, CDF/PDF, central limit theorem, confidence intervals, and basic hypothesis tests.

**2027 status:** the live official GATE 2027 syllabus could not be verified while preparing this pack (the official site was unreachable from this environment). Treat this as preparation mapped to the established DA syllabus, not confirmation that the 2027 bulletin is unchanged. Before the exam, check the official GATE 2027 DA syllabus and information brochure published by the organizing institute. Search the official GATE 2027 website for “DA syllabus” and compare its Probability and Statistics section with the list above.

**Past-paper note:** the 50-question “PYQ-style” pack is newly written practice, not a transcription of past GATE questions. Use official GATE question papers and answer keys from the official GATE website to review verbatim past papers; this pack does not claim its items appeared in an earlier exam.

## A reliable order of study

1. **Counting and event algebra:** permutations, combinations, complements, unions and partitions.
2. **Conditional reasoning:** conditional probability, multiplication rule, independence and Bayes' theorem.
3. **Random variables:** PMF/PDF/CDF, expectation, variance, covariance and transformations.
4. **Named distributions:** Bernoulli, binomial, geometric, Poisson, uniform, exponential and normal; recognize when a model applies.
5. **Sampling and inference:** sample means, CLT, standard error, confidence intervals, z/t tests and chi-square tests.
6. **Timed mixed practice:** first solve by topic, then mix topics and practise deciding which model applies before calculating.

For each error, record whether it came from choosing the wrong event, confusing conditional with joint probability, using the wrong distribution, or making an arithmetic/rounding error. Re-solve missed questions after a delay without looking at the solution.

## Formula and decision sheet

### Events and conditioning

- $P(A^c)=1-P(A)$.
- $P(A\cup B)=P(A)+P(B)-P(A\cap B)$.
- $P(A\mid B)=P(A\cap B)/P(B)$, for $P(B)>0$.
- $P(A\cap B)=P(A\mid B)P(B)$.
- Independence means $P(A\cap B)=P(A)P(B)$; it is not the same as disjointness.
- For a partition $(A_i)$, $P(B)=\sum_i P(B\mid A_i)P(A_i)$ and $P(A_j\mid B)=P(B\mid A_j)P(A_j)/P(B)$.
- Count equally likely outcomes only after confirming they really are equally likely. For sampling without replacement, the denominator and dependence change after each draw.

### Random variables and distributions

- $E[X]=\sum_x x p(x)$ (discrete) or $\int x f(x)\,dx$ (continuous).
- $\operatorname{Var}(X)=E[X^2]-E[X]^2$; $\operatorname{Var}(aX+b)=a^2\operatorname{Var}(X)$.
- $\operatorname{Cov}(X,Y)=E[XY]-E[X]E[Y]$; $\rho_{XY}=\operatorname{Cov}(X,Y)/(\sigma_X\sigma_Y)$ when both standard deviations are nonzero.
- $F_X(x)=P(X\le x)$. For a continuous variable, $F_X(x)=\int_{-\infty}^x f_X(t)\,dt$ and $P(a<X\le b)=F_X(b)-F_X(a)$.
- Bernoulli$(p)$: $E[X]=p$, $\operatorname{Var}(X)=p(1-p)$.
- Binomial$(n,p)$: $P(X=k)=\binom nk p^k(1-p)^{n-k}$, $E[X]=np$, $\operatorname{Var}(X)=np(1-p)$.
- Poisson$(\lambda)$: $P(X=k)=e^{-\lambda}\lambda^k/k!$, and $E[X]=\operatorname{Var}(X)=\lambda$.
- Uniform$(a,b)$: density $1/(b-a)$ on $[a,b]$, mean $(a+b)/2$, variance $(b-a)^2/12$.
- Exponential$(\lambda)$: $f(x)=\lambda e^{-\lambda x}$ for $x\ge0$, mean $1/\lambda$, and $P(X>x)=e^{-\lambda x}$.
- Normal$(\mu,\sigma^2)$: standardize with $Z=(X-\mu)/\sigma$. The variance is $\sigma^2$, not $\sigma$.

### Sampling and tests

- For independent identically distributed observations with finite variance, $\bar X$ has mean $\mu$ and standard error $\sigma/\sqrt n$. The CLT approximates its standardized distribution by a standard normal for sufficiently large $n$; it does not say that the original observations become normal.
- A confidence interval estimates a parameter using an estimate plus/minus a critical value times its standard error. A 95% interval procedure has 95% long-run coverage; it is not a 95% probability statement about a fixed parameter after observing the data.
- In a one-sample z test with known $\sigma$, $z=(\bar x-\mu_0)/(\sigma/\sqrt n)$. For an unknown population standard deviation under the usual normal-sample assumptions, use $t=(\bar x-\mu_0)/(s/\sqrt n)$ with $n-1$ degrees of freedom.
- A chi-square goodness-of-fit statistic is $\sum_i (O_i-E_i)^2/E_i$. Check expected counts and degrees of freedom; for a basic fit test with $k$ categories and no estimated parameters, df is $k-1$.
- Decide the alternative hypothesis and whether a test is one- or two-sided **before** comparing a statistic with a critical value or interpreting a p-value.

## Common traps to watch

- $P(A\mid B)$ and $P(A\cap B)$ answer different questions.
- Mutually exclusive events with positive probabilities are dependent.
- “At least one” is often simpler as one minus “none.”
- The binomial model requires a fixed number of independent trials and a constant success probability.
- A continuous variable has zero probability at any one exact point; interval probabilities come from area.
- Variance scales by $a^2$ under multiplication by $a$, while standard deviation scales by $|a|$.
- Correlation zero does not generally imply independence.
- A larger sample reduces standard error at rate $1/\sqrt n$, not $1/n$.

## Included practice and assessment

- **Easy:** 25 questions to establish definitions, counting, and direct distribution calculations.
- **Medium:** 50 questions combining rules, conditioning, common distributions, and sampling.
- **Hard:** 100 multi-step questions spanning dependence, mixed distributions, transformations, asymptotics, and inference.
- **PYQ-style:** 50 newly written questions in a concise GATE-like format; these are not actual previous-year questions.
- **Sectional exam:** a short timed mixed assessment with a worked solution for every question.

The practice banks are importable Localdox practice files. Upload the four `.practice.md` files, the exam triplet, the study plan, and the probability taxonomy together. For an authoritative syllabus update, replace this pack's scope only after comparing it with the official 2027 DA syllabus.
