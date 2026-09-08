/** Complete worked examples from the supplied exercises, ready for the Writing preview. */
export const solutionExamples = [
  { name: "Exercise 7 · Triple integral", value: String.raw`\begin{array}{l}
\text{Integrate in the order }z,\ y,\ x.\\
I=\int_0^1\int_0^1\int_0^1(x^2+y^2+z^2)\,dz\,dy\,dx\\
\text{First, hold }x\text{ and }y\text{ constant:}\\
\int_0^1(x^2+y^2+z^2)\,dz
=\left[(x^2+y^2)z+\frac{z^3}{3}\right]_0^1\\
=x^2+y^2+\frac13.\\
\text{Next, integrate with respect to }y\text{:}\\
\int_0^1\left(x^2+y^2+\frac13\right)\,dy
=\left[x^2y+\frac{y^3}{3}+\frac y3\right]_0^1\\
=x^2+\frac23.\\
\text{Finally, integrate with respect to }x\text{:}\\
I=\int_0^1\left(x^2+\frac23\right)\,dx\\
=\left[\frac{x^3}{3}+\frac{2x}{3}\right]_0^1
=\frac13+\frac23=1.\\
\boxed{I=1}
\end{array}` },
  { name: "Exercise 8 · Variable limits", value: String.raw`\begin{array}{l}
I=\int_0^{\sqrt2}\int_0^{3y}\int_{x^2+3y^2}^{8-x^2-y^2}1\,dz\,dx\,dy\\
\text{The inner integral is upper minus lower limit:}\\
\int_{x^2+3y^2}^{8-x^2-y^2}1\,dz
=(8-x^2-y^2)-(x^2+3y^2)\\
=8-2x^2-4y^2.\\
\text{Integrate with respect to }x\text{:}\\
\int_0^{3y}(8-2x^2-4y^2)\,dx
=\left[(8-4y^2)x-\frac{2x^3}{3}\right]_0^{3y}\\
=24y-12y^3-18y^3=24y-30y^3.\\
\text{Integrate with respect to }y\text{:}\\
I=\left[12y^2-\frac{15}{2}y^4\right]_0^{\sqrt2}\\
=24-30=-6.\\
\boxed{I=-6}\\
\text{Some inner limits are reversed.}\\
\text{This is a signed integral.}
\end{array}` },
  { name: "Exercise 9 · Logarithmic integral", value: String.raw`\begin{array}{l}
I=\int_1^e\int_1^{e^2}\int_1^{e^3}\frac{1}{xyz}\,dx\,dy\,dz\\
\text{All variables are positive.}\\
\text{Integrate in the given order:}\\
\int_1^{e^3}\frac{1}{xyz}\,dx
=\frac{1}{yz}[\ln x]_1^{e^3}=\frac{3}{yz}.\\
\text{Next, integrate with respect to }y\text{:}\\
\int_1^{e^2}\frac{3}{yz}\,dy
=\frac{3}{z}[\ln y]_1^{e^2}=\frac{6}{z}.\\
\text{Finally, integrate with respect to }z\text{:}\\
I=\int_1^e\frac6z\,dz=6[\ln z]_1^e=6.\\
\boxed{I=6}
\end{array}` },
  { name: "Exercise 2.1-2 · Probability mass function", value: String.raw`\begin{array}{l}
\text{There are 6 white chips,}\\
\text{3 red chips and 1 blue chip.}\\
\text{One chip is chosen at random.}\\
\text{All 10 chips are equally likely.}\\
N=6+3+1=10.\\
\text{The possible values are }X\in\{1,5,10\}.\\
\text{For each value, count the matching chips:}\\
P(X=1)=P(\text{white})=\frac6{10}=\frac35=0.6,\\
P(X=5)=P(\text{red})=\frac3{10}=0.3,\\
P(X=10)=P(\text{blue})=\frac1{10}=0.1.\\
\text{Thus the probability mass function is}\\
p_X(x)=\begin{cases}
\frac35,&x=1,\\
\frac3{10},&x=5,\\
\frac1{10},&x=10,\\
0,&\text{otherwise}.
\end{cases}\\
\text{All probabilities are nonnegative.}\\
\text{Check that their sum is 1:}\\
\frac35+\frac3{10}+\frac1{10}=\frac{6+3+1}{10}=1.
\end{array}` },
];
