:::solution{#section-q1 answer=A}
By inclusion-exclusion, $P(A\cup B)=P(A)+P(B)-P(A\cap B)=0.4+0.5-0.2=0.7$. Adding the two event probabilities without subtracting the overlap would double-count it.

::distractor{option=B trap=union-overcount}
:::

:::solution{#section-q2 answer=0.4 tolerance=0.0001}
The conditional probability is $P(A\mid B)=P(A\cap B)/P(B)=0.12/0.3=0.4$.
:::

:::solution{#section-q3 answer=B}
The binomial formula gives $P(X=2)=\binom42(0.5)^2(0.5)^2=6/16=0.375$.

::distractor{option=A trap=binomial-coefficient}
:::

:::solution{#section-q4 answer=0.1353 tolerance=0.0001}
For a Poisson variable, $P(X=0)=e^{-2}2^0/0!=e^{-2}\approx0.1353$.
:::

:::solution{#section-q5 answer=C}
$E[X]=0(0.2)+1(0.5)+2(0.3)=1.1$.

::distractor{option=B trap=expected-value}
:::

:::solution{#section-q6 answer="A,B,C"}
Adding a constant does not change variance, multiplying a random variable by 2 multiplies its variance by $2^2$, and expectation is linear. The last statement needs independence (or zero covariance); it is not always true.
:::

:::solution{#section-q7 answer=0.5556 tolerance=0.0001}
The overall defect probability is $0.2(0.05)+0.8(0.01)=0.018$. Bayes' theorem gives $P(F_1\mid D)=0.2(0.05)/0.018=0.5556$ to four decimal places.
:::

:::solution{#section-q8 answer=0.5 tolerance=0.0001}
For a uniform distribution, probability equals the interval length divided by the full range length: $(3-1)/(4-0)=0.5$. Endpoints have zero probability for a continuous variable.
:::

:::solution{#section-q9 answer=A}
$P(Z>1)=1-P(Z\le1)=1-0.8413=0.1587$.

::distractor{option=B trap=normal-tail}
:::

:::solution{#section-q10 answer=2 tolerance=0.0001}
The standard error is $\sigma/\sqrt n=12/\sqrt{36}=12/6=2$.
:::

:::solution{#section-q11 answer=C}
$\operatorname{Cov}(X,Y)=E[XY]-E[X]E[Y]=8-(2)(3)=2$.

::distractor{option=D trap=independence-covariance}
:::

:::solution{#section-q12 answer=1 tolerance=0.0001}
$z=(\bar{x}-\mu_0)/(\sigma/\sqrt n)=(52-50)/(8/\sqrt{16})=2/2=1$.
:::
