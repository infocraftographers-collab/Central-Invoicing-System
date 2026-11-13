"""
Indian Currency to Words Converter
Supports Lakhs, Crores, and Paise in standard Indian format.
"""

def number_to_indian_words(num):
    try:
        num = float(num)
    except (ValueError, TypeError):
        return ""

    if num == 0:
        return "Zero Rupees Only"

    is_negative = num < 0
    num = abs(num)

    rupees = int(num)
    paise = int(round((num - rupees) * 100))

    if paise == 100:
        rupees += 1
        paise = 0

    ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
            "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
            "Seventeen", "Eighteen", "Nineteen"]
    tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

    def convert_two_digit(n):
        if n == 0:
            return ""
        if n < 20:
            return ones[n]
        tens_part = tens[n // 10]
        ones_part = ones[n % 10]
        if ones_part:
            return f"{tens_part} {ones_part}"
        return tens_part

    def convert_three_digit(n):
        hundreds = n // 100
        remainder = n % 100
        parts = []
        if hundreds > 0:
            parts.append(f"{ones[hundreds]} Hundred")
        if remainder > 0:
            parts.append(convert_two_digit(remainder))
        return " ".join(parts)

    parts = []

    # Indian Number System: Crores (10^7), Lakhs (10^5), Thousands (10^3), Hundreds (10^2), Units
    crores = rupees // 10000000
    remainder = rupees % 10000000

    if crores > 0:
        parts.append(f"{convert_three_digit(crores)} Crore")

    lakhs = remainder // 100000
    remainder = remainder % 100000

    if lakhs > 0:
        parts.append(f"{convert_two_digit(lakhs)} Lakh")

    thousands = remainder // 1000
    remainder = remainder % 1000

    if thousands > 0:
        parts.append(f"{convert_two_digit(thousands)} Thousand")

    if remainder > 0:
        parts.append(convert_three_digit(remainder))

    rupees_str = " ".join([p for p in parts if p]).strip()
    if not rupees_str:
        rupees_str = "Zero"

    res = f"{rupees_str} Rupees"
    if paise > 0:
        paise_str = convert_two_digit(paise)
        res += f" and {paise_str} Paise"

    res += " Only"
    if is_negative:
        res = f"Minus {res}"

    return res

if __name__ == "__main__":
    print(number_to_indian_words(799136))
    print(number_to_indian_words(10638600))
    print(number_to_indian_words(9015762.72))
