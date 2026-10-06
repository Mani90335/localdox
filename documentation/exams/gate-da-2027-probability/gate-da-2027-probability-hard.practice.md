:::question{#gate-da-2027-probability-hard-001 type=nat marks=1 topic=prob.bayes difficulty=hard}
Three factories supply 20%, 30%, 50% of items and have defect rates 1%, 2%, and 4%. Given a defective item, find the probability it came from factory 2.
:::

:::solution{#gate-da-2027-probability-hard-001 answer=0.214286 tolerance=0.0001}
Apply Bayes: $P(F_2\mid D)=0.3(0.02)/[0.2(0.01)+0.3(0.02)+0.5(0.04)]\approx0.214286$.
:::

:::question{#gate-da-2027-probability-hard-002 type=nat marks=1 topic=prob.bayes difficulty=hard}
Three factories supply 20%, 30%, 50% of items and have defect rates 1%, 2.5%, and 4%. Given a defective item, find the probability it came from factory 2.
:::

:::solution{#gate-da-2027-probability-hard-002 answer=0.254237 tolerance=0.0001}
Apply Bayes: $P(F_2\mid D)=0.3(0.025)/[0.2(0.01)+0.3(0.025)+0.5(0.04)]\approx0.254237$.
:::

:::question{#gate-da-2027-probability-hard-003 type=nat marks=1 topic=prob.bayes difficulty=hard}
Three factories supply 20%, 30%, 50% of items and have defect rates 1%, 3%, and 4%. Given a defective item, find the probability it came from factory 2.
:::

:::solution{#gate-da-2027-probability-hard-003 answer=0.290323 tolerance=0.0001}
Apply Bayes: $P(F_2\mid D)=0.3(0.03)/[0.2(0.01)+0.3(0.03)+0.5(0.04)]\approx0.290323$.
:::

:::question{#gate-da-2027-probability-hard-004 type=nat marks=1 topic=prob.bayes difficulty=hard}
Three factories supply 20%, 30%, 50% of items and have defect rates 1%, 3.5%, and 4%. Given a defective item, find the probability it came from factory 2.
:::

:::solution{#gate-da-2027-probability-hard-004 answer=0.323077 tolerance=0.0001}
Apply Bayes: $P(F_2\mid D)=0.3(0.035)/[0.2(0.01)+0.3(0.035)+0.5(0.04)]\approx0.323077$.
:::

:::question{#gate-da-2027-probability-hard-005 type=nat marks=1 topic=prob.bayes difficulty=hard}
Three factories supply 20%, 30%, 50% of items and have defect rates 1%, 4%, and 4%. Given a defective item, find the probability it came from factory 2.
:::

:::solution{#gate-da-2027-probability-hard-005 answer=0.352941 tolerance=0.0001}
Apply Bayes: $P(F_2\mid D)=0.3(0.04)/[0.2(0.01)+0.3(0.04)+0.5(0.04)]\approx0.352941$.
:::

:::question{#gate-da-2027-probability-hard-006 type=nat marks=1 topic=prob.count difficulty=hard}
A box contains 5 red and 7 blue tokens. Three are drawn without replacement. Find the probability exactly two are red.
:::

:::solution{#gate-da-2027-probability-hard-006 answer=0.318182 tolerance=0.0001}
Use the hypergeometric count: $\binom{5}2\binom{7}1/\binom{12}3\approx0.318182$.
:::

:::question{#gate-da-2027-probability-hard-007 type=nat marks=1 topic=prob.count difficulty=hard}
A box contains 6 red and 7 blue tokens. Three are drawn without replacement. Find the probability exactly two are red.
:::

:::solution{#gate-da-2027-probability-hard-007 answer=0.367133 tolerance=0.0001}
Use the hypergeometric count: $\binom{6}2\binom{7}1/\binom{13}3\approx0.367133$.
:::

:::question{#gate-da-2027-probability-hard-008 type=nat marks=1 topic=prob.count difficulty=hard}
A box contains 7 red and 7 blue tokens. Three are drawn without replacement. Find the probability exactly two are red.
:::

:::solution{#gate-da-2027-probability-hard-008 answer=0.403846 tolerance=0.0001}
Use the hypergeometric count: $\binom{7}2\binom{7}1/\binom{14}3\approx0.403846$.
:::

:::question{#gate-da-2027-probability-hard-009 type=nat marks=1 topic=prob.count difficulty=hard}
A box contains 8 red and 7 blue tokens. Three are drawn without replacement. Find the probability exactly two are red.
:::

:::solution{#gate-da-2027-probability-hard-009 answer=0.430769 tolerance=0.0001}
Use the hypergeometric count: $\binom{8}2\binom{7}1/\binom{15}3\approx0.430769$.
:::

:::question{#gate-da-2027-probability-hard-010 type=nat marks=1 topic=prob.count difficulty=hard}
A box contains 9 red and 7 blue tokens. Three are drawn without replacement. Find the probability exactly two are red.
:::

:::solution{#gate-da-2027-probability-hard-010 answer=0.45 tolerance=0.0001}
Use the hypergeometric count: $\binom{9}2\binom{7}1/\binom{16}3\approx0.45$.
:::

:::question{#gate-da-2027-probability-hard-011 type=nat marks=1 topic=prob.dist difficulty=hard}
For $X\sim\mathrm{Binomial}(6,0.2)$, find $P(X\ge2)$.
:::

:::solution{#gate-da-2027-probability-hard-011 answer=0.34464 tolerance=0.0001}
Use the complement: $P(X\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\approx0.34464$.
:::

:::question{#gate-da-2027-probability-hard-012 type=nat marks=1 topic=prob.dist difficulty=hard}
For $X\sim\mathrm{Binomial}(7,0.3)$, find $P(X\ge2)$.
:::

:::solution{#gate-da-2027-probability-hard-012 answer=0.670583 tolerance=0.0001}
Use the complement: $P(X\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\approx0.670583$.
:::

:::question{#gate-da-2027-probability-hard-013 type=nat marks=1 topic=prob.dist difficulty=hard}
For $X\sim\mathrm{Binomial}(8,0.4)$, find $P(X\ge2)$.
:::

:::solution{#gate-da-2027-probability-hard-013 answer=0.893624 tolerance=0.0001}
Use the complement: $P(X\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\approx0.893624$.
:::

:::question{#gate-da-2027-probability-hard-014 type=nat marks=1 topic=prob.dist difficulty=hard}
For $X\sim\mathrm{Binomial}(9,0.5)$, find $P(X\ge2)$.
:::

:::solution{#gate-da-2027-probability-hard-014 answer=0.980469 tolerance=0.0001}
Use the complement: $P(X\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\approx0.980469$.
:::

:::question{#gate-da-2027-probability-hard-015 type=nat marks=1 topic=prob.dist difficulty=hard}
For $X\sim\mathrm{Binomial}(10,0.6)$, find $P(X\ge2)$.
:::

:::solution{#gate-da-2027-probability-hard-015 answer=0.998322 tolerance=0.0001}
Use the complement: $P(X\ge2)=1-P(0)-P(1)=1-(1-p)^n-np(1-p)^{n-1}\approx0.998322$.
:::

:::question{#gate-da-2027-probability-hard-016 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent exponential waiting times have rates 1 and 2. Find the expected time until the first event.
:::

:::solution{#gate-da-2027-probability-hard-016 answer=0.333333 tolerance=0.0001}
The minimum is exponential with rate $\lambda_1+\lambda_2$. Thus $E[\min(X,Y)]=1/(1+2)=0.333333$.
:::

:::question{#gate-da-2027-probability-hard-017 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent exponential waiting times have rates 2 and 3. Find the expected time until the first event.
:::

:::solution{#gate-da-2027-probability-hard-017 answer=0.2 tolerance=0.0001}
The minimum is exponential with rate $\lambda_1+\lambda_2$. Thus $E[\min(X,Y)]=1/(2+3)=0.2$.
:::

:::question{#gate-da-2027-probability-hard-018 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent exponential waiting times have rates 3 and 4. Find the expected time until the first event.
:::

:::solution{#gate-da-2027-probability-hard-018 answer=0.142857 tolerance=0.0001}
The minimum is exponential with rate $\lambda_1+\lambda_2$. Thus $E[\min(X,Y)]=1/(3+4)=0.142857$.
:::

:::question{#gate-da-2027-probability-hard-019 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent exponential waiting times have rates 4 and 5. Find the expected time until the first event.
:::

:::solution{#gate-da-2027-probability-hard-019 answer=0.111111 tolerance=0.0001}
The minimum is exponential with rate $\lambda_1+\lambda_2$. Thus $E[\min(X,Y)]=1/(4+5)=0.111111$.
:::

:::question{#gate-da-2027-probability-hard-020 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent exponential waiting times have rates 5 and 6. Find the expected time until the first event.
:::

:::solution{#gate-da-2027-probability-hard-020 answer=0.090909 tolerance=0.0001}
The minimum is exponential with rate $\lambda_1+\lambda_2$. Thus $E[\min(X,Y)]=1/(5+6)=0.090909$.
:::

:::question{#gate-da-2027-probability-hard-021 type=nat marks=1 topic=prob.limit difficulty=hard}
A population has mean 10 and standard deviation 2. For $n=4$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\bar X>12).
:::

:::solution{#gate-da-2027-probability-hard-021 answer=0.1587 tolerance=0.0001}
The standardized cutoff is $(12-10)/[2/\sqrt{4}]=1$. By the supplied normal-tail value, the probability is 0.1587.
:::

:::question{#gate-da-2027-probability-hard-022 type=nat marks=1 topic=prob.limit difficulty=hard}
A population has mean 11 and standard deviation 3. For $n=8$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\bar X>14).
:::

:::solution{#gate-da-2027-probability-hard-022 answer=0.1587 tolerance=0.0001}
The standardized cutoff is $(14-11)/[3/\sqrt{8}]=1$. By the supplied normal-tail value, the probability is 0.1587.
:::

:::question{#gate-da-2027-probability-hard-023 type=nat marks=1 topic=prob.limit difficulty=hard}
A population has mean 12 and standard deviation 4. For $n=12$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\bar X>16).
:::

:::solution{#gate-da-2027-probability-hard-023 answer=0.1587 tolerance=0.0001}
The standardized cutoff is $(16-12)/[4/\sqrt{12}]=1$. By the supplied normal-tail value, the probability is 0.1587.
:::

:::question{#gate-da-2027-probability-hard-024 type=nat marks=1 topic=prob.limit difficulty=hard}
A population has mean 13 and standard deviation 5. For $n=16$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\bar X>18).
:::

:::solution{#gate-da-2027-probability-hard-024 answer=0.1587 tolerance=0.0001}
The standardized cutoff is $(18-13)/[5/\sqrt{16}]=1$. By the supplied normal-tail value, the probability is 0.1587.
:::

:::question{#gate-da-2027-probability-hard-025 type=nat marks=1 topic=prob.limit difficulty=hard}
A population has mean 14 and standard deviation 6. For $n=20$ independent observations, use $P(Z>1)=0.1587$ to approximate $P(\bar X>20).
:::

:::solution{#gate-da-2027-probability-hard-025 answer=0.1587 tolerance=0.0001}
The standardized cutoff is $(20-14)/[6/\sqrt{20}]=1$. By the supplied normal-tail value, the probability is 0.1587.
:::

:::question{#gate-da-2027-probability-hard-026 type=nat marks=1 topic=prob.limit difficulty=hard}
A sample proportion estimates a population proportion near 0.2. For sample size 100, find its approximate standard error.
:::

:::solution{#gate-da-2027-probability-hard-026 answer=0.04 tolerance=0.0001}
$SE(\hat p)=\sqrt{p(1-p)/n}=\sqrt{0.16/100}\approx0.04$.
:::

:::question{#gate-da-2027-probability-hard-027 type=nat marks=1 topic=prob.limit difficulty=hard}
A sample proportion estimates a population proportion near 0.3. For sample size 200, find its approximate standard error.
:::

:::solution{#gate-da-2027-probability-hard-027 answer=0.032404 tolerance=0.0001}
$SE(\hat p)=\sqrt{p(1-p)/n}=\sqrt{0.21/200}\approx0.032404$.
:::

:::question{#gate-da-2027-probability-hard-028 type=nat marks=1 topic=prob.limit difficulty=hard}
A sample proportion estimates a population proportion near 0.4. For sample size 300, find its approximate standard error.
:::

:::solution{#gate-da-2027-probability-hard-028 answer=0.028284 tolerance=0.0001}
$SE(\hat p)=\sqrt{p(1-p)/n}=\sqrt{0.24/300}\approx0.028284$.
:::

:::question{#gate-da-2027-probability-hard-029 type=nat marks=1 topic=prob.limit difficulty=hard}
A sample proportion estimates a population proportion near 0.5. For sample size 400, find its approximate standard error.
:::

:::solution{#gate-da-2027-probability-hard-029 answer=0.025 tolerance=0.0001}
$SE(\hat p)=\sqrt{p(1-p)/n}=\sqrt{0.25/400}\approx0.025$.
:::

:::question{#gate-da-2027-probability-hard-030 type=nat marks=1 topic=prob.limit difficulty=hard}
A sample proportion estimates a population proportion near 0.6. For sample size 500, find its approximate standard error.
:::

:::solution{#gate-da-2027-probability-hard-030 answer=0.021909 tolerance=0.0001}
$SE(\hat p)=\sqrt{p(1-p)/n}=\sqrt{0.24/500}\approx0.021909$.
:::

:::question{#gate-da-2027-probability-hard-031 type=nat marks=1 topic=prob.joint difficulty=hard}
$\sigma_X=2$, $\sigma_Y=3$, and $\operatorname{Corr}(X,Y)=0.5$. Find $\operatorname{Var}(2X-Y)$.
:::

:::solution{#gate-da-2027-probability-hard-031 answer=13 tolerance=0.0001}
$\operatorname{Var}(2X-Y)=4\sigma_X^2+\sigma_Y^2-4\operatorname{Cov}(X,Y)$, where covariance is $0.5(2)(3)$. The result is 13$.
:::

:::question{#gate-da-2027-probability-hard-032 type=nat marks=1 topic=prob.joint difficulty=hard}
$\sigma_X=3$, $\sigma_Y=4$, and $\operatorname{Corr}(X,Y)=0.5$. Find $\operatorname{Var}(2X-Y)$.
:::

:::solution{#gate-da-2027-probability-hard-032 answer=28 tolerance=0.0001}
$\operatorname{Var}(2X-Y)=4\sigma_X^2+\sigma_Y^2-4\operatorname{Cov}(X,Y)$, where covariance is $0.5(3)(4)$. The result is 28$.
:::

:::question{#gate-da-2027-probability-hard-033 type=nat marks=1 topic=prob.joint difficulty=hard}
$\sigma_X=4$, $\sigma_Y=5$, and $\operatorname{Corr}(X,Y)=0.5$. Find $\operatorname{Var}(2X-Y)$.
:::

:::solution{#gate-da-2027-probability-hard-033 answer=49 tolerance=0.0001}
$\operatorname{Var}(2X-Y)=4\sigma_X^2+\sigma_Y^2-4\operatorname{Cov}(X,Y)$, where covariance is $0.5(4)(5)$. The result is 49$.
:::

:::question{#gate-da-2027-probability-hard-034 type=nat marks=1 topic=prob.joint difficulty=hard}
$\sigma_X=5$, $\sigma_Y=6$, and $\operatorname{Corr}(X,Y)=0.5$. Find $\operatorname{Var}(2X-Y)$.
:::

:::solution{#gate-da-2027-probability-hard-034 answer=76 tolerance=0.0001}
$\operatorname{Var}(2X-Y)=4\sigma_X^2+\sigma_Y^2-4\operatorname{Cov}(X,Y)$, where covariance is $0.5(5)(6)$. The result is 76$.
:::

:::question{#gate-da-2027-probability-hard-035 type=nat marks=1 topic=prob.joint difficulty=hard}
$\sigma_X=6$, $\sigma_Y=7$, and $\operatorname{Corr}(X,Y)=0.5$. Find $\operatorname{Var}(2X-Y)$.
:::

:::solution{#gate-da-2027-probability-hard-035 answer=109 tolerance=0.0001}
$\operatorname{Var}(2X-Y)=4\sigma_X^2+\sigma_Y^2-4\operatorname{Cov}(X,Y)$, where covariance is $0.5(6)(7)$. The result is 109$.
:::

:::question{#gate-da-2027-probability-hard-036 type=nat marks=1 topic=prob.moments difficulty=hard}
$X$ is Bernoulli with success probability 0.25. Find $E[(2X+2)^2]$.
:::

:::solution{#gate-da-2027-probability-hard-036 answer=7 tolerance=0.0001}
When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(0.25)+4(1-0.25)=7$.
:::

:::question{#gate-da-2027-probability-hard-037 type=nat marks=1 topic=prob.moments difficulty=hard}
$X$ is Bernoulli with success probability 0.35. Find $E[(2X+2)^2]$.
:::

:::solution{#gate-da-2027-probability-hard-037 answer=8.2 tolerance=0.0001}
When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(0.35)+4(1-0.35)=8.2$.
:::

:::question{#gate-da-2027-probability-hard-038 type=nat marks=1 topic=prob.moments difficulty=hard}
$X$ is Bernoulli with success probability 0.45. Find $E[(2X+2)^2]$.
:::

:::solution{#gate-da-2027-probability-hard-038 answer=9.4 tolerance=0.0001}
When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(0.45)+4(1-0.45)=9.4$.
:::

:::question{#gate-da-2027-probability-hard-039 type=nat marks=1 topic=prob.moments difficulty=hard}
$X$ is Bernoulli with success probability 0.55. Find $E[(2X+2)^2]$.
:::

:::solution{#gate-da-2027-probability-hard-039 answer=10.6 tolerance=0.0001}
When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(0.55)+4(1-0.55)=10.6$.
:::

:::question{#gate-da-2027-probability-hard-040 type=nat marks=1 topic=prob.moments difficulty=hard}
$X$ is Bernoulli with success probability 0.65. Find $E[(2X+2)^2]$.
:::

:::solution{#gate-da-2027-probability-hard-040 answer=11.8 tolerance=0.0001}
When $X=1$ the squared value is 16; when $X=0$ it is 4. Hence $16(0.65)+4(1-0.65)=11.8$.
:::

:::question{#gate-da-2027-probability-hard-041 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent counts are Poisson with rates 2 and 3. Find the variance of their sum.
:::

:::solution{#gate-da-2027-probability-hard-041 answer=5 tolerance=0.0001}
Independent Poisson variables sum to a Poisson variable with rate $\lambda_1+\lambda_2=2+3=5$; a Poisson variance equals its rate.
:::

:::question{#gate-da-2027-probability-hard-042 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent counts are Poisson with rates 3 and 4. Find the variance of their sum.
:::

:::solution{#gate-da-2027-probability-hard-042 answer=7 tolerance=0.0001}
Independent Poisson variables sum to a Poisson variable with rate $\lambda_1+\lambda_2=3+4=7$; a Poisson variance equals its rate.
:::

:::question{#gate-da-2027-probability-hard-043 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent counts are Poisson with rates 4 and 5. Find the variance of their sum.
:::

:::solution{#gate-da-2027-probability-hard-043 answer=9 tolerance=0.0001}
Independent Poisson variables sum to a Poisson variable with rate $\lambda_1+\lambda_2=4+5=9$; a Poisson variance equals its rate.
:::

:::question{#gate-da-2027-probability-hard-044 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent counts are Poisson with rates 5 and 6. Find the variance of their sum.
:::

:::solution{#gate-da-2027-probability-hard-044 answer=11 tolerance=0.0001}
Independent Poisson variables sum to a Poisson variable with rate $\lambda_1+\lambda_2=5+6=11$; a Poisson variance equals its rate.
:::

:::question{#gate-da-2027-probability-hard-045 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent counts are Poisson with rates 6 and 7. Find the variance of their sum.
:::

:::solution{#gate-da-2027-probability-hard-045 answer=13 tolerance=0.0001}
Independent Poisson variables sum to a Poisson variable with rate $\lambda_1+\lambda_2=6+7=13$; a Poisson variance equals its rate.
:::

:::question{#gate-da-2027-probability-hard-046 type=nat marks=1 topic=prob.inference difficulty=hard}
A normal population has known standard deviation 5. For $n=100$, find the 95% confidence-interval margin using critical value 1.96.
:::

:::solution{#gate-da-2027-probability-hard-046 answer=0.98 tolerance=0.0001}
$1.96\sigma/\sqrt n=1.96(5)/10=0.98$.
:::

:::question{#gate-da-2027-probability-hard-047 type=nat marks=1 topic=prob.inference difficulty=hard}
A normal population has known standard deviation 6. For $n=100$, find the 95% confidence-interval margin using critical value 1.96.
:::

:::solution{#gate-da-2027-probability-hard-047 answer=1.176 tolerance=0.0001}
$1.96\sigma/\sqrt n=1.96(6)/10=1.176$.
:::

:::question{#gate-da-2027-probability-hard-048 type=nat marks=1 topic=prob.inference difficulty=hard}
A normal population has known standard deviation 7. For $n=100$, find the 95% confidence-interval margin using critical value 1.96.
:::

:::solution{#gate-da-2027-probability-hard-048 answer=1.372 tolerance=0.0001}
$1.96\sigma/\sqrt n=1.96(7)/10=1.372$.
:::

:::question{#gate-da-2027-probability-hard-049 type=nat marks=1 topic=prob.inference difficulty=hard}
A normal population has known standard deviation 8. For $n=100$, find the 95% confidence-interval margin using critical value 1.96.
:::

:::solution{#gate-da-2027-probability-hard-049 answer=1.568 tolerance=0.0001}
$1.96\sigma/\sqrt n=1.96(8)/10=1.568$.
:::

:::question{#gate-da-2027-probability-hard-050 type=nat marks=1 topic=prob.inference difficulty=hard}
A normal population has known standard deviation 9. For $n=100$, find the 95% confidence-interval margin using critical value 1.96.
:::

:::solution{#gate-da-2027-probability-hard-050 answer=1.764 tolerance=0.0001}
$1.96\sigma/\sqrt n=1.96(9)/10=1.764$.
:::

:::question{#gate-da-2027-probability-hard-051 type=nat marks=1 topic=prob.inference difficulty=hard}
A z test has $\bar x=12$, null mean 10, known $\sigma=4$, and $n=16$. Find the z statistic.
:::

:::solution{#gate-da-2027-probability-hard-051 answer=2 tolerance=0.0001}
$z=(\bar x-\mu_0)/(\sigma/\sqrt n)=(12-10)/(4/4)=2$.
:::

:::question{#gate-da-2027-probability-hard-052 type=nat marks=1 topic=prob.inference difficulty=hard}
A z test has $\bar x=13$, null mean 10, known $\sigma=5$, and $n=16$. Find the z statistic.
:::

:::solution{#gate-da-2027-probability-hard-052 answer=2.4 tolerance=0.0001}
$z=(\bar x-\mu_0)/(\sigma/\sqrt n)=(13-10)/(5/4)=2.4$.
:::

:::question{#gate-da-2027-probability-hard-053 type=nat marks=1 topic=prob.inference difficulty=hard}
A z test has $\bar x=14$, null mean 10, known $\sigma=6$, and $n=16$. Find the z statistic.
:::

:::solution{#gate-da-2027-probability-hard-053 answer=2.666667 tolerance=0.0001}
$z=(\bar x-\mu_0)/(\sigma/\sqrt n)=(14-10)/(6/4)=2.666667$.
:::

:::question{#gate-da-2027-probability-hard-054 type=nat marks=1 topic=prob.inference difficulty=hard}
A z test has $\bar x=15$, null mean 10, known $\sigma=7$, and $n=16$. Find the z statistic.
:::

:::solution{#gate-da-2027-probability-hard-054 answer=2.857143 tolerance=0.0001}
$z=(\bar x-\mu_0)/(\sigma/\sqrt n)=(15-10)/(7/4)=2.857143$.
:::

:::question{#gate-da-2027-probability-hard-055 type=nat marks=1 topic=prob.inference difficulty=hard}
A z test has $\bar x=16$, null mean 10, known $\sigma=8$, and $n=16$. Find the z statistic.
:::

:::solution{#gate-da-2027-probability-hard-055 answer=3 tolerance=0.0001}
$z=(\bar x-\mu_0)/(\sigma/\sqrt n)=(16-10)/(8/4)=3$.
:::

:::question{#gate-da-2027-probability-hard-056 type=nat marks=1 topic=prob.inference difficulty=hard}
A 2 by 2 table has observed counts [[8,10],[12,10]]. Find the Pearson chi-square statistic for independence.
:::

:::solution{#gate-da-2027-probability-hard-056 answer=0.40404 tolerance=0.0001}
Compute expected counts as row total times column total divided by 40; then sum $(O-E)^2/E$ over four cells. This gives $0.40404$.
:::

:::question{#gate-da-2027-probability-hard-057 type=nat marks=1 topic=prob.inference difficulty=hard}
A 2 by 2 table has observed counts [[9,11],[13,11]]. Find the Pearson chi-square statistic for independence.
:::

:::solution{#gate-da-2027-probability-hard-057 answer=0.366667 tolerance=0.0001}
Compute expected counts as row total times column total divided by 44; then sum $(O-E)^2/E$ over four cells. This gives $0.366667$.
:::

:::question{#gate-da-2027-probability-hard-058 type=nat marks=1 topic=prob.inference difficulty=hard}
A 2 by 2 table has observed counts [[10,12],[14,12]]. Find the Pearson chi-square statistic for independence.
:::

:::solution{#gate-da-2027-probability-hard-058 answer=0.335664 tolerance=0.0001}
Compute expected counts as row total times column total divided by 48; then sum $(O-E)^2/E$ over four cells. This gives $0.335664$.
:::

:::question{#gate-da-2027-probability-hard-059 type=nat marks=1 topic=prob.inference difficulty=hard}
A 2 by 2 table has observed counts [[11,13],[15,13]]. Find the Pearson chi-square statistic for independence.
:::

:::solution{#gate-da-2027-probability-hard-059 answer=0.309524 tolerance=0.0001}
Compute expected counts as row total times column total divided by 52; then sum $(O-E)^2/E$ over four cells. This gives $0.309524$.
:::

:::question{#gate-da-2027-probability-hard-060 type=nat marks=1 topic=prob.inference difficulty=hard}
A 2 by 2 table has observed counts [[12,14],[16,14]]. Find the Pearson chi-square statistic for independence.
:::

:::solution{#gate-da-2027-probability-hard-060 answer=0.287179 tolerance=0.0001}
Compute expected counts as row total times column total divided by 56; then sum $(O-E)^2/E$ over four cells. This gives $0.287179$.
:::

:::question{#gate-da-2027-probability-hard-061 type=nat marks=1 topic=prob.inference difficulty=hard}
In 20 independent Bernoulli trials, 7 are successes. Find the maximum-likelihood estimate of the success probability.
:::

:::solution{#gate-da-2027-probability-hard-061 answer=0.35 tolerance=0.0001}
The Bernoulli likelihood is maximized at the observed proportion: $\hat p=x/n=7/20=0.35$.
:::

:::question{#gate-da-2027-probability-hard-062 type=nat marks=1 topic=prob.inference difficulty=hard}
In 25 independent Bernoulli trials, 8 are successes. Find the maximum-likelihood estimate of the success probability.
:::

:::solution{#gate-da-2027-probability-hard-062 answer=0.32 tolerance=0.0001}
The Bernoulli likelihood is maximized at the observed proportion: $\hat p=x/n=8/25=0.32$.
:::

:::question{#gate-da-2027-probability-hard-063 type=nat marks=1 topic=prob.inference difficulty=hard}
In 30 independent Bernoulli trials, 9 are successes. Find the maximum-likelihood estimate of the success probability.
:::

:::solution{#gate-da-2027-probability-hard-063 answer=0.3 tolerance=0.0001}
The Bernoulli likelihood is maximized at the observed proportion: $\hat p=x/n=9/30=0.3$.
:::

:::question{#gate-da-2027-probability-hard-064 type=nat marks=1 topic=prob.inference difficulty=hard}
In 35 independent Bernoulli trials, 10 are successes. Find the maximum-likelihood estimate of the success probability.
:::

:::solution{#gate-da-2027-probability-hard-064 answer=0.285714 tolerance=0.0001}
The Bernoulli likelihood is maximized at the observed proportion: $\hat p=x/n=10/35=0.285714$.
:::

:::question{#gate-da-2027-probability-hard-065 type=nat marks=1 topic=prob.inference difficulty=hard}
In 40 independent Bernoulli trials, 11 are successes. Find the maximum-likelihood estimate of the success probability.
:::

:::solution{#gate-da-2027-probability-hard-065 answer=0.275 tolerance=0.0001}
The Bernoulli likelihood is maximized at the observed proportion: $\hat p=x/n=11/40=0.275$.
:::

:::question{#gate-da-2027-probability-hard-066 type=nat marks=1 topic=prob.moments difficulty=hard}
A group indicator $G$ has $P(G=1)=0.3$. Conditional means are $E[X\mid G=1]=2$ and $E[X\mid G=0]=5$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-hard-066 answer=4.1 tolerance=0.0001}
Use total expectation: $E[X]=0.3(2)+(1-0.3)(5)=4.1$.
:::

:::question{#gate-da-2027-probability-hard-067 type=nat marks=1 topic=prob.moments difficulty=hard}
A group indicator $G$ has $P(G=1)=0.35$. Conditional means are $E[X\mid G=1]=3$ and $E[X\mid G=0]=6$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-hard-067 answer=4.95 tolerance=0.0001}
Use total expectation: $E[X]=0.35(3)+(1-0.35)(6)=4.95$.
:::

:::question{#gate-da-2027-probability-hard-068 type=nat marks=1 topic=prob.moments difficulty=hard}
A group indicator $G$ has $P(G=1)=0.4$. Conditional means are $E[X\mid G=1]=4$ and $E[X\mid G=0]=7$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-hard-068 answer=5.8 tolerance=0.0001}
Use total expectation: $E[X]=0.4(4)+(1-0.4)(7)=5.8$.
:::

:::question{#gate-da-2027-probability-hard-069 type=nat marks=1 topic=prob.moments difficulty=hard}
A group indicator $G$ has $P(G=1)=0.45$. Conditional means are $E[X\mid G=1]=5$ and $E[X\mid G=0]=8$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-hard-069 answer=6.65 tolerance=0.0001}
Use total expectation: $E[X]=0.45(5)+(1-0.45)(8)=6.65$.
:::

:::question{#gate-da-2027-probability-hard-070 type=nat marks=1 topic=prob.moments difficulty=hard}
A group indicator $G$ has $P(G=1)=0.5$. Conditional means are $E[X\mid G=1]=6$ and $E[X\mid G=0]=9$. Find $E[X]$.
:::

:::solution{#gate-da-2027-probability-hard-070 answer=7.5 tolerance=0.0001}
Use total expectation: $E[X]=0.5(6)+(1-0.5)(9)=7.5$.
:::

:::question{#gate-da-2027-probability-hard-071 type=nat marks=1 topic=prob.rv difficulty=hard}
A continuous variable has constant density on [1,5]. Find $P(2<X\le 4)$.
:::

:::solution{#gate-da-2027-probability-hard-071 answer=0.5 tolerance=0.0001}
The density is $1/(5-1)=0.25$, so interval probability is $(4-2)(0.25)=0.5$.
:::

:::question{#gate-da-2027-probability-hard-072 type=nat marks=1 topic=prob.rv difficulty=hard}
A continuous variable has constant density on [2,7]. Find $P(3.25<X\le 5.75)$.
:::

:::solution{#gate-da-2027-probability-hard-072 answer=0.5 tolerance=0.0001}
The density is $1/(7-2)=0.2$, so interval probability is $(5.75-3.25)(0.2)=0.5$.
:::

:::question{#gate-da-2027-probability-hard-073 type=nat marks=1 topic=prob.rv difficulty=hard}
A continuous variable has constant density on [3,9]. Find $P(4.5<X\le 7.5)$.
:::

:::solution{#gate-da-2027-probability-hard-073 answer=0.5 tolerance=0.0001}
The density is $1/(9-3)=0.166667$, so interval probability is $(7.5-4.5)(0.166667)=0.5$.
:::

:::question{#gate-da-2027-probability-hard-074 type=nat marks=1 topic=prob.rv difficulty=hard}
A continuous variable has constant density on [4,11]. Find $P(5.75<X\le 9.25)$.
:::

:::solution{#gate-da-2027-probability-hard-074 answer=0.5 tolerance=0.0001}
The density is $1/(11-4)=0.142857$, so interval probability is $(9.25-5.75)(0.142857)=0.5$.
:::

:::question{#gate-da-2027-probability-hard-075 type=nat marks=1 topic=prob.rv difficulty=hard}
A continuous variable has constant density on [5,13]. Find $P(7<X\le 11)$.
:::

:::solution{#gate-da-2027-probability-hard-075 answer=0.5 tolerance=0.0001}
The density is $1/(13-5)=0.125$, so interval probability is $(11-7)(0.125)=0.5$.
:::

:::question{#gate-da-2027-probability-hard-076 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent $X\sim\mathrm{Binomial}(4,0.25)$ and $Y\sim\mathrm{Binomial}(6,0.25)$. Find $E[X+Y]$.
:::

:::solution{#gate-da-2027-probability-hard-076 answer=2.5 tolerance=0.0001}
Linearity gives $E[X+Y]=n_1p+n_2p=(4+6)(0.25)=2.5$.
:::

:::question{#gate-da-2027-probability-hard-077 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent $X\sim\mathrm{Binomial}(5,0.25)$ and $Y\sim\mathrm{Binomial}(7,0.25)$. Find $E[X+Y]$.
:::

:::solution{#gate-da-2027-probability-hard-077 answer=3 tolerance=0.0001}
Linearity gives $E[X+Y]=n_1p+n_2p=(5+7)(0.25)=3$.
:::

:::question{#gate-da-2027-probability-hard-078 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent $X\sim\mathrm{Binomial}(6,0.25)$ and $Y\sim\mathrm{Binomial}(8,0.25)$. Find $E[X+Y]$.
:::

:::solution{#gate-da-2027-probability-hard-078 answer=3.5 tolerance=0.0001}
Linearity gives $E[X+Y]=n_1p+n_2p=(6+8)(0.25)=3.5$.
:::

:::question{#gate-da-2027-probability-hard-079 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent $X\sim\mathrm{Binomial}(7,0.25)$ and $Y\sim\mathrm{Binomial}(9,0.25)$. Find $E[X+Y]$.
:::

:::solution{#gate-da-2027-probability-hard-079 answer=4 tolerance=0.0001}
Linearity gives $E[X+Y]=n_1p+n_2p=(7+9)(0.25)=4$.
:::

:::question{#gate-da-2027-probability-hard-080 type=nat marks=1 topic=prob.dist difficulty=hard}
Independent $X\sim\mathrm{Binomial}(8,0.25)$ and $Y\sim\mathrm{Binomial}(10,0.25)$. Find $E[X+Y]$.
:::

:::solution{#gate-da-2027-probability-hard-080 answer=4.5 tolerance=0.0001}
Linearity gives $E[X+Y]=n_1p+n_2p=(8+10)(0.25)=4.5$.
:::

:::question{#gate-da-2027-probability-hard-081 type=nat marks=1 topic=prob.moments difficulty=hard}
For $X\sim\mathrm{Binomial}(10,0.2)$, find its variance.
:::

:::solution{#gate-da-2027-probability-hard-081 answer=1.6 tolerance=0.0001}
$\operatorname{Var}(X)=np(1-p)=10(0.2)(1-0.2)=1.6$.
:::

:::question{#gate-da-2027-probability-hard-082 type=nat marks=1 topic=prob.moments difficulty=hard}
For $X\sim\mathrm{Binomial}(12,0.3)$, find its variance.
:::

:::solution{#gate-da-2027-probability-hard-082 answer=2.52 tolerance=0.0001}
$\operatorname{Var}(X)=np(1-p)=12(0.3)(1-0.3)=2.52$.
:::

:::question{#gate-da-2027-probability-hard-083 type=nat marks=1 topic=prob.moments difficulty=hard}
For $X\sim\mathrm{Binomial}(14,0.4)$, find its variance.
:::

:::solution{#gate-da-2027-probability-hard-083 answer=3.36 tolerance=0.0001}
$\operatorname{Var}(X)=np(1-p)=14(0.4)(1-0.4)=3.36$.
:::

:::question{#gate-da-2027-probability-hard-084 type=nat marks=1 topic=prob.moments difficulty=hard}
For $X\sim\mathrm{Binomial}(16,0.5)$, find its variance.
:::

:::solution{#gate-da-2027-probability-hard-084 answer=4 tolerance=0.0001}
$\operatorname{Var}(X)=np(1-p)=16(0.5)(1-0.5)=4$.
:::

:::question{#gate-da-2027-probability-hard-085 type=nat marks=1 topic=prob.moments difficulty=hard}
For $X\sim\mathrm{Binomial}(18,0.6)$, find its variance.
:::

:::solution{#gate-da-2027-probability-hard-085 answer=4.32 tolerance=0.0001}
$\operatorname{Var}(X)=np(1-p)=18(0.6)(1-0.6)=4.32$.
:::

:::question{#gate-da-2027-probability-hard-086 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent Poisson processes have rates 1 and 2. Find the probability of no event from either process in the next 0.5 time unit.
:::

:::solution{#gate-da-2027-probability-hard-086 answer=0.22313 tolerance=0.0001}
The combined process has rate $\lambda_1+\lambda_2=3$. Thus $P(N=0)=e^{-(3)(0.5)}\approx0.22313$.
:::

:::question{#gate-da-2027-probability-hard-087 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent Poisson processes have rates 2 and 3. Find the probability of no event from either process in the next 0.5 time unit.
:::

:::solution{#gate-da-2027-probability-hard-087 answer=0.082085 tolerance=0.0001}
The combined process has rate $\lambda_1+\lambda_2=5$. Thus $P(N=0)=e^{-(5)(0.5)}\approx0.082085$.
:::

:::question{#gate-da-2027-probability-hard-088 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent Poisson processes have rates 3 and 4. Find the probability of no event from either process in the next 0.5 time unit.
:::

:::solution{#gate-da-2027-probability-hard-088 answer=0.030197 tolerance=0.0001}
The combined process has rate $\lambda_1+\lambda_2=7$. Thus $P(N=0)=e^{-(7)(0.5)}\approx0.030197$.
:::

:::question{#gate-da-2027-probability-hard-089 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent Poisson processes have rates 4 and 5. Find the probability of no event from either process in the next 0.5 time unit.
:::

:::solution{#gate-da-2027-probability-hard-089 answer=0.011109 tolerance=0.0001}
The combined process has rate $\lambda_1+\lambda_2=9$. Thus $P(N=0)=e^{-(9)(0.5)}\approx0.011109$.
:::

:::question{#gate-da-2027-probability-hard-090 type=nat marks=1 topic=prob.dist difficulty=hard}
Two independent Poisson processes have rates 5 and 6. Find the probability of no event from either process in the next 0.5 time unit.
:::

:::solution{#gate-da-2027-probability-hard-090 answer=0.004087 tolerance=0.0001}
The combined process has rate $\lambda_1+\lambda_2=11$. Thus $P(N=0)=e^{-(11)(0.5)}\approx0.004087$.
:::

:::question{#gate-da-2027-probability-hard-091 type=nat marks=1 topic=prob.moments difficulty=hard}
A group $G$ has probability 0.25. Conditional means of $X$ are 2 if $G=1$ and 6 otherwise; conditional variances are 1 and 2. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-hard-091 answer=4.75 tolerance=0.0001}
Use total variance: $E[\operatorname{Var}(X\mid G)]+\operatorname{Var}(E[X\mid G])$. The conditional mean is 5; substitution gives $4.75$.
:::

:::question{#gate-da-2027-probability-hard-092 type=nat marks=1 topic=prob.moments difficulty=hard}
A group $G$ has probability 0.25. Conditional means of $X$ are 3 if $G=1$ and 7 otherwise; conditional variances are 2 and 3. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-hard-092 answer=5.75 tolerance=0.0001}
Use total variance: $E[\operatorname{Var}(X\mid G)]+\operatorname{Var}(E[X\mid G])$. The conditional mean is 6; substitution gives $5.75$.
:::

:::question{#gate-da-2027-probability-hard-093 type=nat marks=1 topic=prob.moments difficulty=hard}
A group $G$ has probability 0.25. Conditional means of $X$ are 4 if $G=1$ and 8 otherwise; conditional variances are 3 and 4. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-hard-093 answer=6.75 tolerance=0.0001}
Use total variance: $E[\operatorname{Var}(X\mid G)]+\operatorname{Var}(E[X\mid G])$. The conditional mean is 7; substitution gives $6.75$.
:::

:::question{#gate-da-2027-probability-hard-094 type=nat marks=1 topic=prob.moments difficulty=hard}
A group $G$ has probability 0.25. Conditional means of $X$ are 5 if $G=1$ and 9 otherwise; conditional variances are 4 and 5. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-hard-094 answer=7.75 tolerance=0.0001}
Use total variance: $E[\operatorname{Var}(X\mid G)]+\operatorname{Var}(E[X\mid G])$. The conditional mean is 8; substitution gives $7.75$.
:::

:::question{#gate-da-2027-probability-hard-095 type=nat marks=1 topic=prob.moments difficulty=hard}
A group $G$ has probability 0.25. Conditional means of $X$ are 6 if $G=1$ and 10 otherwise; conditional variances are 5 and 6. Find $\operatorname{Var}(X)$.
:::

:::solution{#gate-da-2027-probability-hard-095 answer=8.75 tolerance=0.0001}
Use total variance: $E[\operatorname{Var}(X\mid G)]+\operatorname{Var}(E[X\mid G])$. The conditional mean is 9; substitution gives $8.75$.
:::

:::question{#gate-da-2027-probability-hard-096 type=nat marks=1 topic=prob.dist difficulty=hard}
An exponential lifetime has rate $0.5$. Find the probability it is at most 1.
:::

:::solution{#gate-da-2027-probability-hard-096 answer=0.393469 tolerance=0.0001}
$F(x)=1-e^{-\lambda x}=1-e^{-0.5(1)}\approx0.393469$.
:::

:::question{#gate-da-2027-probability-hard-097 type=nat marks=1 topic=prob.dist difficulty=hard}
An exponential lifetime has rate $0.75$. Find the probability it is at most 2.
:::

:::solution{#gate-da-2027-probability-hard-097 answer=0.77687 tolerance=0.0001}
$F(x)=1-e^{-\lambda x}=1-e^{-0.75(2)}\approx0.77687$.
:::

:::question{#gate-da-2027-probability-hard-098 type=nat marks=1 topic=prob.dist difficulty=hard}
An exponential lifetime has rate $1$. Find the probability it is at most 3.
:::

:::solution{#gate-da-2027-probability-hard-098 answer=0.950213 tolerance=0.0001}
$F(x)=1-e^{-\lambda x}=1-e^{-1(3)}\approx0.950213$.
:::

:::question{#gate-da-2027-probability-hard-099 type=nat marks=1 topic=prob.dist difficulty=hard}
An exponential lifetime has rate $1.25$. Find the probability it is at most 4.
:::

:::solution{#gate-da-2027-probability-hard-099 answer=0.993262 tolerance=0.0001}
$F(x)=1-e^{-\lambda x}=1-e^{-1.25(4)}\approx0.993262$.
:::

:::question{#gate-da-2027-probability-hard-100 type=nat marks=1 topic=prob.dist difficulty=hard}
An exponential lifetime has rate $1.5$. Find the probability it is at most 5.
:::

:::solution{#gate-da-2027-probability-hard-100 answer=0.999447 tolerance=0.0001}
$F(x)=1-e^{-\lambda x}=1-e^{-1.5(5)}\approx0.999447$.
:::

