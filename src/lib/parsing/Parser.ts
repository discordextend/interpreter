import { TokenStream } from "./TokenStream";
import { TokenType } from "../TokenType";
import type {
	Token,
	CallToken,
	IfToken,
	ProgramToken,
	VariableToken,
	PropertyToken,
	ParserToken,
	AssignToken
} from "../Token";

export class Parser {
	/**
	 * The precendences of the interpreter
	 */
	private static readonly PRECEDENCE: {
		[precedence: string]: number;
	} = {
		"=": 1,
		"||": 2,
		"&&": 3,
		"<": 7,
		">": 7,
		"<=": 7,
		">=": 7,
		"==": 7,
		"!=": 7,
		"+": 10,
		"-": 10,
		"+=": 10,
		"-=": 10,
		"*": 20,
		"/": 20,
		"%": 20
	};

	/**
	 * Tokens that get used multiple times
	 */
	private static readonly TOKENS: {
		FALSE: Token<TokenType.Boolean>;
	} = {
		FALSE: {
			type: TokenType.Boolean,
			value: false
		}
	};

	/**
	 * Make a new parser
	 * @param input The token stream to use as input
	 */
	public constructor(private readonly input: TokenStream) {
		if (!(this.input instanceof TokenStream)) throw new TypeError("Parser input should be of type TokenStream");
	}

	/**
	 * Check if a token is a punctuation token
	 * @param character The character to check
	 * @returns The token if it is a punctuation token, false otherwise
	 */
	private isPunctuation(character?: string) {
		const token = this.input.peek();
		return (
			token &&
			token.type === TokenType.Punctuation &&
			(!character || token.value === character) &&
			(token as Token<TokenType.Punctuation>)
		);
	}

	/**
	 * Check if a token is a keyword token
	 * @param keyword The character to check
	 * @returns The token if it is a keyword token, false otherwise
	 */
	private isKeyword(keyword: string) {
		const token = this.input.peek();
		return (
			token &&
			token.type === TokenType.Keyword &&
			(!keyword || token.value === keyword) &&
			(token as Token<TokenType.Keyword>)
		);
	}

	/**
	 * Check if a token is an operator token
	 * @param operator The character to check
	 * @returns The token if it is an operator token, false otherwise
	 */
	private isOperator(operator?: string) {
		const token = this.input.peek();
		return (
			token &&
			token.type === TokenType.Operator &&
			(!operator || token.value === operator) &&
			(token as Token<TokenType.Operator>)
		);
	}

	/**
	 * Skip a punctuation character
	 * @param character The character to skip
	 */
	private skipPunctuation(character: string) {
		if (this.isPunctuation(character)) {
			this.input.next();
			return;
		}
		this.input.error(`Expecting punctuation: "${character}"`);
	}

	/**
	 * Skip a keyword character
	 * @param keyword The keyword to skip
	 */
	private skipKeyword(keyword: string) {
		if (this.isKeyword(keyword)) {
			this.input.next();
			return;
		}
		this.input.error(`Expecting punctuation: "${keyword}"`);
	}

	private skipOperator(operator: string) {
		if (this.isOperator(operator)) {
			this.input.next();
			return;
		}
		this.input.error(`Expecting operator: "${operator}"`);
	}

	/**
	 * Throw an error about an unexpected token
	 */
	private unexpected() {
		return this.input.error(`Unexpected token: ${JSON.stringify(this.input.peek())}`);
	}

	/**
	 * @param left The left token
	 * @param myPrecedence The current precedence
	 */
	private maybeBinary(left: ParserToken, myPrecedence: number): ParserToken {
		const token = this.isOperator();
		if (token) {
			const hisPrecedence: number = Parser.PRECEDENCE[token.value];
			if (hisPrecedence > myPrecedence) {
				this.input.next();
				return this.maybeBinary(
					{
						type: token.value === "=" ? TokenType.Assign : TokenType.Binary,
						operator: token.value,
						left,
						right: this.maybeBinary(this.parseAtom(), hisPrecedence)
					},
					myPrecedence
				);
			}
		}
		return left;
	}

	/**
	 * @param start The starting character to skip
	 * @param stop The character to stop at
	 * @param seperator The seperator to use
	 * @param parser The parser to use
	 * @param seperatorRequired Wether a seperator is required
	 * @returns The parsed values
	 */
	private delimited<V = any>(
		start: string,
		stop: string,
		seperator: string,
		parser: (...args: any[]) => V,
		seperatorRequired = true
	): V[] {
		const values = [];
		let first = true;
		this.skipPunctuation(start);
		while (!this.input.eof()) {
			if (this.isPunctuation(stop)) break;
			if (first) {
				first = false;
			} else if (seperatorRequired || this.isPunctuation(seperator)) this.skipPunctuation(seperator);
			if (this.isPunctuation(stop)) break;
			values.push(parser());
		}
		this.skipPunctuation(stop);
		return values;
	}

	/**
	 * Parse a call token
	 * @param func The function to use in the call
	 * @returns The parsed call token
	 */
	private parseCall(func: ParserToken): CallToken {
		return {
			type: TokenType.Call,
			func,
			args: this.delimited("(", ")", ",", () => this.parseExpression())
		};
	}

	/**
	 * Parse an if token
	 * @returns The parsed if token
	 */
	private parseIf(): IfToken {
		this.skipKeyword("if");
		const condition = this.parseExpression();
		this.skipPunctuation(":");
		const value: IfToken = {
			type: TokenType.If,
			condition,
			then: this.parseExpression(),
			elseIf: []
		};
		if (this.isPunctuation(";")) this.input.next();
		while (this.isKeyword("else")) {
			this.input.next();
			if (!this.isKeyword("if")) {
				this.skipPunctuation(":");
				value.else = this.parseExpression();
				break;
			}
			this.input.next();
			const elseIfCondition = this.parseExpression();
			this.skipPunctuation(":");
			value.elseIf.push({
				type: TokenType.ElseIf,
				condition: elseIfCondition,
				then: this.parseExpression()
			});
			if (this.isPunctuation(";")) this.input.next();
		}
		return value;
	}

	/**
	 * Parse a boolean token
	 * @returns The parsed boolean token
	 */
	private parseBoolean(): Token<TokenType.Boolean> {
		return {
			type: TokenType.Boolean,
			value: this.input.next()?.value === "true"
		};
	}

	private parseFinal(): AssignToken {
		this.skipKeyword("final");
		const variable = this.parseVariable();
		this.skipOperator("=");
		return {
			type: TokenType.Assign,
			operator: "=",
			final: true,
			left: variable,
			right: this.parseExpression()
		};
	}

	/**
	 * @param expression The expression to use
	 * @returns The parsed call
	 */
	private maybeCall(expression: (...args: any[]) => ParserToken) {
		const newExpression = expression();
		return this.isPunctuation("(") ? this.parseCall(newExpression) : newExpression;
	}

	/**
	 * @returns The parsed atom
	 */
	private parseAtom() {
		return this.maybeCall(() => {
			if (this.isPunctuation("(")) {
				this.input.next();
				const expression = this.parseExpression();
				this.skipPunctuation(")");
				return expression;
			}
			if (this.isPunctuation("{")) return this.parseProgram();
			if (this.isKeyword("if")) return this.parseIf();
			if (this.isKeyword("true") || this.isKeyword("false")) return this.parseBoolean();
			if (this.isKeyword("final")) return this.parseFinal();
			if (this.input.peek()?.type === TokenType.Variable) return this.parseVariable();
			const token = this.input.next();
			if ([TokenType.Number, TokenType.String].includes(token?.type as TokenType)) return token as ParserToken;
			return this.unexpected();
		});
	}

	/**
	 * Parse the input into a program
	 * @returns The parsed input
	 */
	public parse(): ProgramToken {
		const program = [];
		while (!this.input.eof()) {
			program.push(this.parseExpression());
			if (this.isPunctuation(";")) this.input.next();
		}
		return {
			type: TokenType.Program,
			program
		};
	}

	/**
	 * Parse a program
	 * @returns The parsed program
	 */
	private parseProgram(): ParserToken {
		const program = this.delimited(
			"{",
			"}",
			";",
			() => {
				if (this.isPunctuation(";")) this.input.next();
				return this.parseExpression();
			},
			false
		);
		if (program.length === 0) return Parser.TOKENS.FALSE;
		if (program.length === 1) return program[0];
		return {
			type: TokenType.Program,
			program
		};
	}

	/**
	 * Parse an expression
	 * @returns The parsed expression
	 */
	private parseExpression(): ParserToken {
		return this.maybeCall(() => this.maybeBinary(this.parseAtom(), 0));
	}

	/**
	 * Parse a variable
	 * @returns The parsed variable
	 */
	private parseVariable(): VariableToken {
		const variable = (this.input.next() as Token<TokenType.Variable>).value;
		const properties = [];
		while (this.isPunctuation(".")) {
			this.input.next();
			properties.push(this.parseProperty());
		}
		return {
			type: TokenType.Variable,
			variable,
			properties
		};
	}

	/**
	 * Parse a property
	 * @returns The parsed property
	 */
	private parseProperty(): PropertyToken {
		const token = this.input.next();
		if (token?.type !== TokenType.Variable) this.unexpected();
		const property: PropertyToken = {
			type: TokenType.Property,
			name: token?.value as string
		};
		if (this.isPunctuation("(")) {
			property.args = this.delimited("(", ")", ",", () => this.parseExpression());
		}
		return property;
	}
}
